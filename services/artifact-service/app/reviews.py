"""UTC FSRS scheduling with private state and two layers of replay protection."""
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from fsrs import Card, Rating, Scheduler
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import text
from rag_http import ApiError
from .learning import flashcards


class DueCard(BaseModel):
    card_id: UUID
    front: str
    back: str
    version: int = Field(ge=0)
    due_at: AwareDatetime | None
    is_due: bool
    citations: list[dict]


class DeckView(BaseModel):
    cards: list[DueCard]
    as_of: AwareDatetime


class ReviewResult(BaseModel):
    card_id: UUID
    version: int = Field(ge=1)
    due_at: AwareDatetime
    reviewed_at: AwareDatetime
    rating: int = Field(ge=1,le=4)


def now_utc():
    return datetime.now(timezone.utc)


async def deck(database, item, user, due_only=False):
    async with database.connect() as connection:
        rows = await connection.execute(text('''
            SELECT card_id,version,due FROM artifacts.card_states WHERE artifact_id=:id AND user_id=:user
        '''), {'id':item['artifact_id'], 'user':user})
        states = {str(row['card_id']):row for row in rows.mappings()}
    now = now_utc()
    cards = []
    for card in flashcards(item):
        saved = states.get(card['card_id'])
        due = saved is None or saved['due']<=now
        if not due_only or due:
            cards.append({**card, 'version':saved['version'] if saved else 0,
                          'due_at':saved['due'] if saved else None, 'is_due':due})
    return {'cards': cards, 'as_of':now}


async def review(database, item, user, card_id, rating, expected_version, key):
    card = next((card for card in flashcards(item) if card['card_id']==str(card_id)), None)
    if card is None:
        raise ApiError(404, 'not_found', 'The card could not be found.')
    request_hash = hashlib.sha256(json.dumps([str(item['artifact_id']),str(card_id),rating,expected_version]).encode()).hexdigest()
    keys = {'id':item['artifact_id'], 'user':user, 'card':card_id, 'key':key}
    async with database.begin() as connection:
        await connection.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 6301))'), {'key':f'{user}:{key}'})
        prior = (await connection.execute(text('''
            SELECT request_hash,result FROM artifacts.card_reviews WHERE user_id=:user AND request_key=:key
        '''), keys)).mappings().one_or_none()
        if prior:
            if prior['request_hash']!=request_hash:
                raise ApiError(409, 'idempotency_conflict', 'The review key is already used.')
            return prior['result']
        await connection.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 6302))'), {'key':f'{user}:{item["artifact_id"]}:{card_id}'})
        saved = (await connection.execute(text('''
            SELECT version,schedule FROM artifacts.card_states
            WHERE artifact_id=:id AND user_id=:user AND card_id=:card FOR UPDATE
        '''), keys)).mappings().one_or_none()
        version = saved['version'] if saved else 0
        if version!=expected_version:
            raise ApiError(409, 'stale_card_version', 'Refresh this card before reviewing it again.')
        exists = await connection.scalar(text('SELECT 1 FROM artifacts.items WHERE artifact_id=:id FOR KEY SHARE'), keys)
        if not exists:
            raise ApiError(404, 'not_found', 'The artifact could not be found.')
        now = now_utc()
        previous = Card.from_dict(saved['schedule']) if saved else Card(card_id=UUID(str(card_id)).int, due=now)
        if previous.last_review and previous.last_review>now:
            raise ApiError(409, 'review_clock_conflict', 'The review clock is earlier than the previous review.')
        scheduled, _log = Scheduler(enable_fuzzing=False).review_card(previous, Rating(rating), review_datetime=now)
        result = {'card_id':str(card_id), 'version':version+1, 'due_at':scheduled.due.isoformat(),
                  'reviewed_at':now.isoformat(), 'rating':rating}
        await connection.execute(text('''
            INSERT INTO artifacts.card_states (artifact_id,user_id,card_id,version,schedule,due)
            VALUES (:id,:user,:card,:version,CAST(:schedule AS jsonb),:due)
            ON CONFLICT (artifact_id,user_id,card_id) DO UPDATE SET version=EXCLUDED.version,
                schedule=EXCLUDED.schedule,due=EXCLUDED.due,updated_at=now()
        '''), {**keys,'version':version+1,'schedule':json.dumps(scheduled.to_dict()),'due':scheduled.due})
        await connection.execute(text('''
            INSERT INTO artifacts.card_reviews (artifact_id,user_id,request_key,card_id,request_hash,rating,reviewed_at,result)
            VALUES (:id,:user,:key,:card,:hash,:rating,:now,CAST(:result AS jsonb))
        '''), {**keys,'hash':request_hash,'rating':rating,'now':now,'result':json.dumps(result)})
        return result

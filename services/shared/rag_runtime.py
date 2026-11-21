"""Operational deadlines shared by callers; never part of embedding identity."""

import os
from dataclasses import dataclass


def seconds(name: str, default: int, maximum: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if not 1 <= value <= maximum:
        raise ValueError(f"{name} must be between 1 and {maximum}.")
    return value


@dataclass(frozen=True)
class RuntimeBudgets:
    parse: int = 300
    embedding: int = 60
    index: int = 1800
    run: int = 210
    batch: int = 16

    @property
    def parse_wall(self) -> int:
        return self.parse + 30

    @property
    def parse_caller(self) -> int:
        return self.parse_wall + 15

    @property
    def embedding_caller(self) -> int:
        return self.embedding + 15

    @property
    def search(self) -> int:
        return self.embedding + 40

    @property
    def search_caller(self) -> int:
        return self.search + 10

    @classmethod
    def from_env(cls) -> "RuntimeBudgets":
        value = cls(
            parse=seconds("DOCUMENT_PARSE_TIMEOUT_SECONDS", 300, 900),
            embedding=seconds("MODEL_EMBEDDING_TIMEOUT_SECONDS", 60, 120),
            index=seconds("INDEX_JOB_TIMEOUT_SECONDS", 1800, 7200),
            run=seconds("RUN_TIMEOUT_SECONDS", 210, 300),
            batch=seconds("INGESTION_EMBED_BATCH_SIZE", 16, 16),
        )
        if value.index <= value.parse_caller + value.embedding_caller + 30:
            raise ValueError("Index deadline must cover parsing, embedding and publication.")
        if value.run <= value.search_caller + 75:
            raise ValueError("Run deadline must cover search and bounded generation repair.")
        return value

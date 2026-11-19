"""Save and recover app-owned Qdrant collections with snapshots."""

import os
import re
import shutil
import sys
import tarfile
from tempfile import TemporaryFile

import httpx

COLLECTION = re.compile(r"rag_chunks_[a-f0-9]{64}")
SNAPSHOT = re.compile(r"[a-zA-Z0-9_.-]+\.snapshot")


def save(client: httpx.Client) -> None:
    collections = client.get("/collections").raise_for_status().json()["result"]["collections"]
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
        for collection in collections:
            name = collection["name"]
            if not COLLECTION.fullmatch(name):
                continue
            path = f"/collections/{name}/snapshots"
            snapshot = client.post(path, params={"wait": "true"}).raise_for_status().json()["result"]
            entry = tarfile.TarInfo(f"{name}/{snapshot['name']}")
            entry.size = snapshot["size"]
            try:
                with client.stream("GET", f"{path}/{snapshot['name']}") as response:
                    response.raise_for_status()
                    archive.addfile(entry, SnapshotStream(response))
            finally:
                client.delete(f"{path}/{snapshot['name']}", params={"wait": "true"}).raise_for_status()


class SnapshotStream:
    def __init__(self, response):
        self.chunks = iter(response.iter_bytes())
        self.buffer = bytearray()

    def read(self, size):
        while len(self.buffer) < size:
            chunk = next(self.chunks, None)
            if chunk is None:
                break
            self.buffer.extend(chunk)
        data = bytes(self.buffer[:size])
        del self.buffer[:size]
        return data


def restore(client: httpx.Client) -> None:
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as archive:
        for member in archive:
            collection, _, filename = member.name.partition("/")
            if not member.isfile() or not COLLECTION.fullmatch(collection) or not SNAPSHOT.fullmatch(filename):
                raise ValueError("Unexpected Qdrant backup entry")
            with TemporaryFile() as payload, archive.extractfile(member) as source:
                shutil.copyfileobj(source, payload)
                payload.seek(0)
                response = client.post(
                    f"/collections/{collection}/snapshots/upload",
                    params={"priority": "snapshot", "wait": "true"},
                    files={"snapshot": (filename, payload, "application/octet-stream")},
                )
                response.raise_for_status()


if __name__ == "__main__":
    with httpx.Client(base_url=os.environ.get("QDRANT_URL", "http://qdrant:6333"),
                      timeout=httpx.Timeout(600, connect=5), trust_env=False) as client:
        {"save": save, "restore": restore}[sys.argv[1]](client)

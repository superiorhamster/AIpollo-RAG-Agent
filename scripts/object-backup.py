"""Stream the private document bucket to or from a tar archive."""

import os
import sys
import tarfile

from minio import Minio

bucket = os.environ["DOCUMENT_BUCKET"]
store = Minio("minio:9000", "rag-documents", os.environ["DOCUMENT_STORAGE_PASSWORD"], secure=False)


def save() -> None:
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
        for item in store.list_objects(bucket, recursive=True):
            entry = tarfile.TarInfo(item.object_name)
            entry.size = item.size
            response = store.get_object(bucket, item.object_name)
            try:
                archive.addfile(entry, response)
            finally:
                response.close()
                response.release_conn()


def restore() -> None:
    import re

    key = re.compile(r"^[a-f0-9-]{36}/[a-f0-9-]{36}/(?:original|preview\.pdf)$")
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as archive:
        for member in archive:
            if not member.isfile() or not key.fullmatch(member.name) or member.size > 25 * 1024 * 1024:
                raise ValueError("Unexpected private bucket backup entry")
            with archive.extractfile(member) as data:
                store.put_object(bucket, member.name, data, member.size)


if __name__ == "__main__":
    {"save": save, "restore": restore}[sys.argv[1]]()

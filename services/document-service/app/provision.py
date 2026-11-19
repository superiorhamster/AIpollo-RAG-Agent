"""Provision the Phase 02 broker topology and private document bucket."""

import os
import re

import httpx
from minio import Minio
from minio.credentials import StaticProvider
from minio.minioadmin import MinioAdmin

from rag_events import EXCHANGE

VHOST = "rag-documents"
ROUTES = {
    "workspace.lifecycle": ("workspace.documents_deleted.v1",),
    "document.lifecycle": ("workspace.deletion_requested.v1",),
    "ingestion.lifecycle": (
        "document.uploaded.v1", "document.deletion_requested.v1", "workspace.deletion_requested.v1",
    ),
}
PRODUCERS = {
    "workspace": ("workspace.deletion_requested.v1",),
    "document": ("document.uploaded.v1", "document.deletion_requested.v1", "workspace.documents_deleted.v1"),
    "ingestion": (),
}


def provision_broker() -> None:
    admin = (os.environ["RABBITMQ_DEFAULT_USER"], os.environ["RABBITMQ_DEFAULT_PASS"])
    with httpx.Client(base_url="http://rabbitmq:15672/api/", auth=admin, timeout=10, trust_env=False) as client:
        client.put(f"vhosts/{VHOST}", json={}).raise_for_status()
        client.put(f"exchanges/{VHOST}/{EXCHANGE}", json={"type": "topic", "durable": True}).raise_for_status()
        for queue, routes in ROUTES.items():
            client.put(f"queues/{VHOST}/{queue}", json={"durable": True}).raise_for_status()
            for route in routes:
                client.post(
                    f"bindings/{VHOST}/e/{EXCHANGE}/q/{queue}",
                    json={"routing_key": route, "arguments": {}},
                ).raise_for_status()
        for service, routes in PRODUCERS.items():
            username = f"rag-{service}"
            client.put(f"users/{username}", json={
                "password": os.environ[f"{service.upper()}_BROKER_PASSWORD"], "tags": "",
            }).raise_for_status()
            client.put(f"permissions/{VHOST}/{username}", json={
                "configure": "^$",
                "write": f"^{re.escape(EXCHANGE)}$" if routes else "^$",
                "read": f"^{re.escape(service + '.lifecycle')}$",
            }).raise_for_status()
            if routes:
                client.put(f"topic-permissions/{VHOST}/{username}", json={
                    "exchange": EXCHANGE,
                    "write": "^(" + "|".join(re.escape(route) for route in routes) + ")$",
                    "read": ".*",
                }).raise_for_status()


def provision_storage() -> None:
    access, secret = os.environ["MINIO_ROOT_USER"], os.environ["MINIO_ROOT_PASSWORD"]
    bucket = os.environ["DOCUMENT_BUCKET"]
    minio = Minio("minio:9000", access_key=access, secret_key=secret, secure=False)
    if not minio.bucket_exists(bucket):
        minio.make_bucket(bucket)
    admin = MinioAdmin(endpoint="minio:9000", credentials=StaticProvider(access, secret), secure=False)
    admin.user_add("rag-documents", os.environ["DOCUMENT_STORAGE_PASSWORD"])
    admin.policy_add("rag-documents", policy={"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
         "Resource": [f"arn:aws:s3:::{bucket}"]},
        {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
         "Resource": [f"arn:aws:s3:::{bucket}/*"]},
    ]})
    admin.policy_set("rag-documents", user="rag-documents")


if __name__ == "__main__":
    provision_broker()
    provision_storage()

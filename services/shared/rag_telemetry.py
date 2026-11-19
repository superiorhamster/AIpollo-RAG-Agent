"""Optional OpenTelemetry export for request and worker operations."""

import logging
import os
from contextlib import contextmanager

from opentelemetry import propagate, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

LOG = logging.getLogger("uvicorn.error")


def configure(service: str) -> None:
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        return
    try:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        LOG.warning("OTLP tracing is unavailable for %s", service)
        return
    provider = TracerProvider(resource=Resource.create({"service.name": service}))
    exporter = OTLPSpanExporter(endpoint=endpoint.rstrip("/") + "/v1/traces", timeout=3)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)


@contextmanager
def server_span(headers, method: str, accept_context: bool = True):
    carrier = {} if not accept_context else {key: headers[key] for key in ("traceparent", "tracestate") if key in headers}
    with trace.get_tracer("rag.http").start_as_current_span(
        method, context=propagate.extract(carrier), kind=SpanKind.SERVER, record_exception=False,
    ) as span:
        yield span


@contextmanager
def operation(name: str, correlation: str):
    with trace.get_tracer("rag.worker").start_as_current_span(name, record_exception=False) as span:
        span.set_attribute("rag.request_id", correlation)
        try:
            yield span
        except Exception:
            span.set_status(Status(StatusCode.ERROR))
            raise


def propagate_trace(headers: dict[str, str]) -> None:
    carrier = {}
    propagate.inject(carrier)
    for key in ("traceparent", "tracestate"):
        if key in carrier:
            headers[key] = carrier[key]

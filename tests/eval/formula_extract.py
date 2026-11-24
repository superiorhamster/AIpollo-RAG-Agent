"""Measure the existing text-layer parser; this does not enable OCR or the inspector."""
import argparse
import hashlib
import json
import sys
from contextlib import redirect_stdout
from io import BytesIO
from pathlib import Path
from formula_quality import evaluate


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--pdf',required=True)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--output')
    parser.add_argument('--require-eligible',action='store_true')
    args=parser.parse_args()
    data=Path(args.pdf).read_bytes()
    error=None
    with redirect_stdout(sys.stderr):
        from app.conversion import parse_pdf
        try:
            chunks=parse_pdf(BytesIO(data))
        except Exception as exc:
            chunks=[]
            error=type(exc).__name__
    result=evaluate(json.loads(Path(args.manifest).read_text()),[chunk.model_dump(mode='json') for chunk in chunks])
    result['parser_error']=error
    result['pdf_sha256']=hashlib.sha256(data).hexdigest()
    if args.output:
        Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
    else:
        print(json.dumps(result,indent=2))
    if args.require_eligible and not result['inspector_enabled']:raise SystemExit(1)


if __name__=='__main__':main()

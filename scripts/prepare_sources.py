"""Convert source PDFs with the bundled skill, preserving original files."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, shutil, subprocess, sys, uuid, os
from opencc import OpenCC
ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ['BILLS_SOURCE_ROOT'])
CONVERTER = Path.home() / '.codex/skills/convert-pdf-to-md/scripts/convert_pdf_to_md.py'
STAGING = ROOT / '.system_generated' / ('conversion-' + uuid.uuid4().hex)
def convert_case(case):
    source, dest = SOURCE / case, STAGING / case
    with (STAGING / (case + '.log')).open('w', encoding='utf-8') as log:
        result = subprocess.run([sys.executable, str(CONVERTER), str(source), '--recursive', '-o', str(dest)], stdout=log, stderr=log)
    cc, outputs = OpenCC('s2twp'), []
    for pdf in sorted(source.rglob('*.pdf')):
        folder = dest / pdf.relative_to(source).parent / pdf.stem
        converted = folder / (pdf.stem + '.md')
        if not converted.exists():
            outputs.append({'source': str(pdf), 'error': 'conversion failed'}); continue
        text = cc.convert(converted.read_text(encoding='utf-8'))
        basename = cc.convert(pdf.stem)
        assets = pdf.parent / (basename + '.assets')
        if (folder / 'img').exists():
            assets.mkdir(exist_ok=True)
            for image in (folder / 'img').iterdir():
                shutil.copy2(image, assets / image.name)
            text = text.replace('](img/', f']({basename}.assets/')
        md = pdf.parent / (basename + '.md')
        if not md.exists(): md.write_text(text, encoding='utf-8')
        outputs.append({'source': str(pdf), 'markdown': str(md), 'text_chars': len(text.split('## Extracted Images')[0].strip()), 'staging': str(folder), 'case': case})
    print(json.dumps({'case': case, 'converter_exit': result.returncode, 'files': len(outputs), 'scanned': sum(x.get('text_chars', 0) < 80 for x in outputs)}, ensure_ascii=False), flush=True)
    return outputs
if __name__ == '__main__':
    STAGING.mkdir(parents=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        manifest = sum(list(pool.map(convert_case, ['學甲一二期', '學甲三四期'])), [])
    (ROOT / '.system_generated' / 'source_manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Manifest saved', flush=True)

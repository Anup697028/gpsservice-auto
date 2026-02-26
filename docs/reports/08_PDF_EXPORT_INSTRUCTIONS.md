# PDF Export Instructions
## Convert Every Report to Separate PDF

## One-Click PowerShell (Recommended)
Run this from the project root:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-reports-pdf.ps1
```

Optional (opens output folder after export):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-reports-pdf.ps1 -OpenOutputFolder
```

What it does:
- Converts all report markdown files in `docs/reports` into individual PDFs.
- Checks for `pandoc` and available PDF engines (`wkhtmltopdf`, `weasyprint`, `xelatex`, `pdflatex`).
- Prints success/failure per file.

## Option A: VS Code Print to PDF (Fast)
1. Open any report `.md` file.
2. Use Markdown preview (`Ctrl+Shift+V`).
3. From preview, print (`Ctrl+P`).
4. Select **Save as PDF**.
5. Name output as:
   - `01_USER_STEP_BY_STEP_GUIDE.pdf`
   - `02_FO_DASHBOARD_GUIDE.pdf`
   - `03_RH_DASHBOARD_GUIDE.pdf`
   - `04_PAYMENT_DASHBOARD_GUIDE.pdf`
   - `05_VENDOR_DASHBOARD_GUIDE.pdf`
   - `06_ADMIN_DASHBOARD_GUIDE.pdf`
   - `07_CTO_MASTER_TECHNICAL_REPORT.pdf`

## Option B: Pandoc (Batch, CLI)
If Pandoc is installed:
```bash
pandoc docs/reports/01_USER_STEP_BY_STEP_GUIDE.md -o docs/reports/01_USER_STEP_BY_STEP_GUIDE.pdf
pandoc docs/reports/02_FO_DASHBOARD_GUIDE.md -o docs/reports/02_FO_DASHBOARD_GUIDE.pdf
pandoc docs/reports/03_RH_DASHBOARD_GUIDE.md -o docs/reports/03_RH_DASHBOARD_GUIDE.pdf
pandoc docs/reports/04_PAYMENT_DASHBOARD_GUIDE.md -o docs/reports/04_PAYMENT_DASHBOARD_GUIDE.pdf
pandoc docs/reports/05_VENDOR_DASHBOARD_GUIDE.md -o docs/reports/05_VENDOR_DASHBOARD_GUIDE.pdf
pandoc docs/reports/06_ADMIN_DASHBOARD_GUIDE.md -o docs/reports/06_ADMIN_DASHBOARD_GUIDE.pdf
pandoc docs/reports/07_CTO_MASTER_TECHNICAL_REPORT.md -o docs/reports/07_CTO_MASTER_TECHNICAL_REPORT.pdf
```

## Suggested Deliverables
- Share each role PDF with corresponding teams.
- Share only the CTO master PDF in leadership technical review.

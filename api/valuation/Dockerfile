FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py build_database.py seed_database.py update_damodaran.py ./
COPY valuation_reference.db ./
# CSV sources shipped so seed_database.py can rebuild the SQLite file
# in-container if ever needed. References.xlsx (1.8 MB) is intentionally
# excluded from the repo as bloat — fetch it separately if you need to
# re-seed from the original Damodaran workbook.
COPY Rates1.csv Rates2.csv Rates3.csv Rates4.csv ./
COPY "Tax Rates.csv" ./

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]

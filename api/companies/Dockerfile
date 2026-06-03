FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py build_database.py sync.py ./

# companies.db is NOT shipped — it is built on first run via:
#   python -c "import sync; sync.run_sync(full=True)"
# (rebuilt from ClickUp, kept out of the image like the valuation DB).

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]

# ============================================================
# api/companies/crm_lists.py — config registry for the CRM list dashboards.
#
# The master DB (companies.db) already mirrors EVERY ClickUp task across the 10
# CRM spaces, not just Deals. This registry describes the simpler per-list
# dashboards (Leads / Accounts Companies / Accounts Individuals) that the
# generic endpoints in main.py serve from that same mirror — no new sync.
#
# Deals is intentionally NOT here: it keeps its own bespoke endpoints
# (search/companies/chart/deals/detail) because it's a TID/GID fee-rollup view,
# a fundamentally different shape. This registry is for the table+detail lists.
#
# --- Field "source" grammar (interpreted by main.py's resolvers) ------------
#   "name"       → the ClickUp task title (company/person name lives here)
#   "status"     → native task status
#   "space"      → space_name
#   "assignees"  → JSON array of assignee display names
#   "tid"        → Clickup_TID
#   "ubos"       → JSON array of normalized UBO names (promoted column)
#   <promoted>   → service | year_of_project | business_year | department | dashboard_tid
#   <other>      → a flattened custom-field key (read from the custom_fields JSON)
#
# Custom-field keys use the same snake_case flattening as the sync
# (name.lower().replace(" ","_").replace("/","_").replace("?","")), e.g.
# "Lead Source" → "lead_source", "Tax Reference (TIC)" → "tax_reference_(tic)".
# Only alnum/underscore keys are used as query/filter sources; keys with
# parentheses etc. appear only in detail_fields (resolved in Python, never via
# SQL json_extract, so quoting is never an issue).
# ============================================================

# Promoted (indexed) columns on the tasks table — resolved directly, not via
# the custom_fields JSON. Mirrors build_database.Task.
PROMOTED_COLUMNS = {"service", "year_of_project", "business_year", "department", "dashboard_tid"}


CRM_LISTS = {
    # ----------------------------------------------------------------
    "leads": {
        "title": "Leads",
        "subtitle": "Sales pipeline — lead source, industry, jurisdiction and status.",
        "list_match": "leads",          # normalized (lower, trimmed) list_name
        "editable": True,
        "value_field": None,            # no money metric
        "cross_link_deals": False,
        # Whole-word search runs over these sources (task title + a few fields).
        "search_fields": ["name", "contact_name"],
        "search_placeholder": "Search lead name, contact or TID-XXXXX…",
        "columns": [
            {"key": "name",         "label": "Name",         "source": "name",         "type": "text"},
            {"key": "contact_name", "label": "Contact",      "source": "contact_name", "type": "text"},
            {"key": "lead_source",  "label": "Lead Source",  "source": "lead_source",  "type": "text"},
            {"key": "industry",     "label": "Industry",     "source": "industry",     "type": "text"},
            {"key": "jurisdiction", "label": "Jurisdiction", "source": "jurisdiction", "type": "text"},
            {"key": "status",       "label": "Status",       "source": "status",       "type": "status"},
            {"key": "assignees",    "label": "Assignees",    "source": "assignees",    "type": "chips"},
        ],
        "filters": [
            {"key": "status",       "label": "Status",       "source": "status"},
            {"key": "lead_source",  "label": "Lead Source",  "source": "lead_source"},
            {"key": "industry",     "label": "Industry",     "source": "industry"},
            {"key": "jurisdiction", "label": "Jurisdiction", "source": "jurisdiction"},
            {"key": "space",        "label": "Companies",        "source": "space"},
            {"key": "assignee",     "label": "Assignee",     "source": "assignees"},
        ],
        "detail_fields": [
            {"key": "contact_name",              "label": "Contact Name"},
            {"key": "job_title",                 "label": "Job Title"},
            {"key": "email",                     "label": "Email"},
            {"key": "phone",                     "label": "Phone"},
            {"key": "lead_source",               "label": "Lead Source"},
            {"key": "lead_details",              "label": "Lead Details"},
            {"key": "industry",                  "label": "Industry"},
            {"key": "jurisdiction",              "label": "Jurisdiction"},
            {"key": "new_potential_or_existing", "label": "New / Existing"},
            {"key": "description",               "label": "Description"},
        ],
        "kpis": {
            "groups": [
                {"key": "status",      "label": "By Status",      "source": "status",      "chart": "bar", "top": 12},
                {"key": "lead_source", "label": "By Lead Source", "source": "lead_source", "chart": "bar", "top": 10},
                {"key": "industry",    "label": "By Industry",    "source": "industry",    "chart": "bar", "top": 10},
            ],
        },
    },

    # ----------------------------------------------------------------
    "accounts_companies": {
        "title": "Accounts — Companies",
        "subtitle": "Company master records — UBO, client code, industry, country and risk.",
        "list_match": "accounts (companies)",
        "editable": True,
        "value_field": None,
        "cross_link_deals": True,       # detail shows this company's Deals (by TID)
        "search_fields": ["name", "client_code"],
        "search_placeholder": "Search company, client code or TID-XXXXX…",
        "columns": [
            {"key": "name",        "label": "Name",        "source": "name",        "type": "text"},
            {"key": "client_code", "label": "Client Code", "source": "client_code", "type": "text"},
            {"key": "industry",    "label": "Industry",    "source": "industry",    "type": "text"},
            {"key": "country",     "label": "Country",     "source": "country",     "type": "text"},
            {"key": "ubos",        "label": "UBO(s)",      "source": "ubos",        "type": "chips"},
            {"key": "status",      "label": "Status",      "source": "status",      "type": "status"},
            {"key": "group_name",  "label": "Group",       "source": "group_name",  "type": "text"},
        ],
        "filters": [
            {"key": "status",     "label": "Status",    "source": "status"},
            {"key": "industry",   "label": "Industry",  "source": "industry"},
            {"key": "country",    "label": "Country",   "source": "country"},
            {"key": "group_name", "label": "Group",     "source": "group_name"},
            {"key": "space",      "label": "Companies", "source": "space"},
            {"key": "assignee",   "label": "Assignee",  "source": "assignees"},
        ],
        "detail_fields": [
            {"key": "client_code",         "label": "Client Code"},
            {"key": "group_name",          "label": "Group Name"},
            {"key": "industry",            "label": "Industry"},
            {"key": "country",             "label": "Country"},
            {"key": "jurisdiction",        "label": "Jurisdiction"},
            {"key": "date_of_inc",         "label": "Date of Incorporation"},
            {"key": "registration_number", "label": "Registration Number"},
            {"key": "tax_reference_(tic)", "label": "Tax Reference (TIC)"},
            {"key": "auditors",            "label": "Auditors"},
            {"key": "administrator",       "label": "Administrator"},
            {"key": "corporate_administrator", "label": "Corporate Administrator"},
            {"key": "accountant",          "label": "Accountant"},
            {"key": "registered_office",   "label": "Registered Office"},
            {"key": "risk_scoring",        "label": "Risk Scoring"},
            {"key": "banks",               "label": "Banks"},
        ],
        "kpis": {
            "groups": [
                {"key": "status",   "label": "By Status",   "source": "status",   "chart": "bar", "top": 12},
                {"key": "country",  "label": "Top Countries", "source": "country", "chart": "bar", "top": 10},
                {"key": "industry", "label": "Top Industries", "source": "industry", "chart": "bar", "top": 10},
            ],
        },
    },

    # ----------------------------------------------------------------
    "accounts_individuals": {
        "title": "Accounts — Individuals",
        # NOTE: the stored list_name has a TRAILING SPACE ("Accounts (Individuals) ").
        # list_match is normalized (trimmed) so matching is done via TRIM() in SQL.
        "title_note": "trailing-space list name; matched via TRIM",
        "subtitle": "Individual client records — client code, country and status.",
        "list_match": "accounts (individuals)",
        "editable": True,
        "value_field": None,
        "cross_link_deals": True,
        "search_fields": ["name", "client_code"],
        "search_placeholder": "Search individual, client code or TID-XXXXX…",
        "columns": [
            {"key": "name",        "label": "Name",        "source": "name",        "type": "text"},
            {"key": "client_code", "label": "Client Code", "source": "client_code", "type": "text"},
            {"key": "country",     "label": "Country",     "source": "country",     "type": "text"},
            {"key": "status",      "label": "Status",      "source": "status",      "type": "status"},
            {"key": "gender",      "label": "Gender",      "source": "gender",      "type": "text"},
        ],
        "filters": [
            {"key": "status",  "label": "Status",  "source": "status"},
            {"key": "country", "label": "Country", "source": "country"},
            {"key": "space",   "label": "Companies",   "source": "space"},
            {"key": "assignee", "label": "Assignee", "source": "assignees"},
        ],
        "detail_fields": [
            {"key": "client_code", "label": "Client Code"},
            {"key": "country",     "label": "Country"},
            {"key": "gender",      "label": "Gender"},
            {"key": "address",     "label": "Address"},
            {"key": "service",     "label": "Service"},
            {"key": "group_name",  "label": "Group Name"},
            {"key": "department",  "label": "Department"},
        ],
        "kpis": {
            "groups": [
                {"key": "status",  "label": "By Status",  "source": "status",  "chart": "bar", "top": 8},
                {"key": "country", "label": "By Country", "source": "country", "chart": "bar", "top": 10},
            ],
        },
    },

    # ----------------------------------------------------------------
    "contacts": {
        "title": "Contacts",
        "subtitle": "People across the CRM — with their linked company.",
        "list_match": "contacts",
        "editable": True,
        "value_field": None,
        "cross_link_deals": False,
        "search_fields": ["name", "email"],
        "search_placeholder": "Search contact name, email or TID-XXXXX…",
        # `company` is a ClickUp list_relationship — rendered as clickable links
        # (type "links"); the backend parses it from the mirror (JSON or legacy).
        "columns": [
            {"key": "name",       "label": "Name",       "source": "name",          "type": "text"},
            {"key": "company",    "label": "Company",    "source": "company",       "type": "links"},
            {"key": "job_title",  "label": "Job Title",  "source": "job_title",     "type": "text"},
            {"key": "email",      "label": "Email",      "source": "email",         "type": "text"},
            {"key": "phone",      "label": "Phone",      "source": "phone",         "type": "text"},
            {"key": "crm_item_type", "label": "Type",    "source": "crm_item_type", "type": "text"},
        ],
        "filters": [
            {"key": "crm_item_type", "label": "Type",     "source": "crm_item_type"},
            {"key": "space",         "label": "Companies", "source": "space"},
            {"key": "assignee",      "label": "Assignee", "source": "assignees"},
        ],
        "detail_fields": [
            {"key": "company",       "label": "Company",   "type": "links"},
            {"key": "job_title",     "label": "Job Title"},
            {"key": "email",         "label": "Email"},
            {"key": "phone",         "label": "Phone"},
            {"key": "phone_2",       "label": "Phone 2"},
            {"key": "raw_phone",     "label": "Raw Phone"},
            {"key": "address",       "label": "Address"},
            {"key": "crm_item_type", "label": "CRM Item Type"},
        ],
        "kpis": {
            "groups": [
                {"key": "crm_item_type", "label": "By Type",      "source": "crm_item_type", "chart": "bar", "top": 10},
                {"key": "job_title",     "label": "Top Job Titles", "source": "job_title",   "chart": "bar", "top": 10},
            ],
        },
    },
}

# List-name matches (normalized) that the write endpoints will accept for edits.
# Deals is always editable (its own dashboard); plus every CRM list flagged
# editable here.
EDITABLE_LIST_MATCHES = {"deals"} | {
    cfg["list_match"] for cfg in CRM_LISTS.values() if cfg.get("editable")
}


def get_list(key: str) -> dict | None:
    return CRM_LISTS.get(key)


def public_registry() -> list[dict]:
    """Serialize the registry for the frontend (no server-only internals)."""
    out = []
    for key, cfg in CRM_LISTS.items():
        out.append({
            "key": key,
            "title": cfg["title"],
            "subtitle": cfg["subtitle"],
            "editable": cfg["editable"],
            "cross_link_deals": cfg.get("cross_link_deals", False),
            "search_placeholder": cfg.get("search_placeholder", "Search…"),
            "columns": cfg["columns"],
            "filters": [{"key": f["key"], "label": f["label"]} for f in cfg["filters"]],
            "kpi_groups": [{"key": g["key"], "label": g["label"], "chart": g.get("chart", "bar")}
                           for g in cfg.get("kpis", {}).get("groups", [])],
        })
    return out

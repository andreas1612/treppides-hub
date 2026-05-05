// ============================================================
// api/mock.js — mock data for local development.
// Shape matches BookStack API responses exactly.
// Used by bookstack.js when USE_MOCK = true.
// Remove or ignore once BookStack is live.
// ============================================================

export default {
  announcements: {
    data: [
      {
        id: 1,
        name: "Q1 2026 Company Update",
        updated_at: "2026-03-20T09:00:00.000Z",
        url: "#",
        preview_html: {
          content: "<p>This quarter we have onboarded three new clients across the financial services sector and expanded the Cyprus team by four members. Full details in the linked report.</p>"
        }
      },
      {
        id: 2,
        name: "New IT Security Policy — Action Required",
        updated_at: "2026-03-15T14:30:00.000Z",
        url: "#",
        preview_html: {
          content: "<p>All staff must complete the updated password policy acknowledgement by 31 March 2026. Please log in to the Knowledge Base and sign off the document in your profile.</p>"
        }
      },
      {
        id: 3,
        name: "Office Closure — Easter 2026",
        updated_at: "2026-03-10T08:00:00.000Z",
        url: "#",
        preview_html: {
          content: "<p>The Nicosia office will be closed from 17 to 21 April 2026 for the Easter holiday period. Emergency contact details are available in the Policies section.</p>"
        }
      }
    ],
    total: 3
  },
  policies: {
    data: [
      {
        id: 10,
        name: "Information Security Policy v3.2",
        updated_at: "2026-02-01T10:00:00.000Z",
        url: "#",
        preview_html: { content: "<p>Defines acceptable use of company systems, data classification levels, and incident reporting procedures for all Treppides staff.</p>" }
      },
      {
        id: 11,
        name: "Remote Working Policy",
        updated_at: "2026-01-15T10:00:00.000Z",
        url: "#",
        preview_html: { content: "<p>Guidelines covering VPN usage, approved devices, working hours expectations, and data handling requirements for remote staff.</p>" }
      },
      {
        id: 12,
        name: "HR Disciplinary Procedure",
        updated_at: "2025-12-01T10:00:00.000Z",
        url: "#",
        preview_html: { content: "<p>Formal procedure for raising and handling disciplinary matters, including timelines, right of appeal, and record keeping requirements.</p>" }
      }
    ],
    total: 3
  },
  training: {
    data: [
      {
        id: 20,
        name: "New Staff Onboarding Guide",
        updated_at: "2026-03-01T10:00:00.000Z",
        url: "#",
        preview_html: { content: "<p>Step by step guide for new joiners covering system access, team introductions, first week schedule, and key contacts across all departments.</p>" }
      },
      {
        id: 21,
        name: "Cybersecurity Awareness Training 2026",
        updated_at: "2026-02-10T10:00:00.000Z",
        url: "#",
        preview_html: { content: "<p>Annual mandatory training covering phishing awareness, password hygiene, social engineering and safe data handling. Estimated 45 minutes.</p>" }
      },
      {
        id: 22,
        name: "BookStack — How to Create and Edit Pages",
        updated_at: "2026-01-20T10:00:00.000Z",
        url: "#",
        preview_html: { content: "<p>Quick reference guide for staff on creating books, chapters and pages in the company knowledge base. Includes screenshots and video walkthrough.</p>" }
      }
    ],
    total: 3
  }
};

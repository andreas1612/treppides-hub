-- CalendarEvents — Team Calendar event storage
-- Target: InternalTools on KTDEV:1433
-- Must be run by DBA (HQ\l.pampaka) — kyc_app has no DDL rights.

USE InternalTools;
GO

CREATE TABLE dbo.CalendarEvents (
  EventId       INT IDENTITY(1,1) PRIMARY KEY,
  Title         NVARCHAR(200)  NOT NULL,
  EventType     NVARCHAR(20)   NOT NULL,   -- LEAVE | MEETING | DEADLINE
  OwnerEmail    NVARCHAR(150)  NOT NULL,   -- person this event belongs to
  Department    NVARCHAR(150)  NOT NULL,   -- Azure AD department value
  StartDate     DATE           NOT NULL,
  EndDate       DATE           NOT NULL,
  AllDay        BIT            DEFAULT 1,
  Notes         NVARCHAR(500)  NULL,
  Status        NVARCHAR(20)   DEFAULT 'APPROVED',  -- PENDING | APPROVED | REJECTED
  CreatedBy     NVARCHAR(150)  NOT NULL,
  CreatedAt     DATETIME2      DEFAULT GETDATE()
);
GO

-- Composite index for department + date range queries (main calendar view)
CREATE INDEX IX_CalendarEvents_Dept_Date
  ON dbo.CalendarEvents (Department, StartDate, EndDate);
GO

-- Index for owner-based lookups (my events)
CREATE INDEX IX_CalendarEvents_Owner
  ON dbo.CalendarEvents (OwnerEmail);
GO

-- Grant kyc_app CRUD permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.CalendarEvents TO kyc_app;
GO

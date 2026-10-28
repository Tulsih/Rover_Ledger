CREATE TABLE "document_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documentName" varchar(255) NOT NULL,
	"documentType" varchar(50) NOT NULL,
	"fileSize" bigint NOT NULL,
	"fileType" varchar(100) NOT NULL,
	"documentDate" timestamp NOT NULL,
	"pdfCreated" boolean DEFAULT false NOT NULL,
	"softDelete" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"oneDriveItemId" varchar(255) NOT NULL,
	"oneDriveWebUrl" text,
	"oneDriveDownloadUrl" text,
	"originalFileName" varchar(255) NOT NULL,
	"uploadedBy" uuid
);
--> statement-breakpoint
ALTER TABLE "Rover_ledgers" ALTER COLUMN "UserId" SET DEFAULT gen_random_uuid();
CREATE TABLE "Rover_ledgers" (
	"UserId" serial PRIMARY KEY NOT NULL,
	"FirstName" varchar(255),
	"LastName" varchar(255),
	"Email" varchar(255) NOT NULL,
	"Gender" varchar(50),
	"Role" varchar(100) DEFAULT 'User' NOT NULL,
	"CreatedAt" timestamp DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp DEFAULT now() NOT NULL,
	"Designation" varchar(255),
	"FullName" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"SoftDelete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "Rover_ledgers_Email_unique" UNIQUE("Email")
);

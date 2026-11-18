ALTER TABLE "document_details" ADD CONSTRAINT "fk_document_details_uploaded_by" FOREIGN KEY ("uploadedBy") REFERENCES "Rover_ledgers"("UserId") ON DELETE cascade ON UPDATE no action;

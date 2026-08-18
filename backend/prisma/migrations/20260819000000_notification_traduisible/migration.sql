-- Notifications traduisibles (D2) : la phrase était écrite en français en base, puis
-- poussée telle quelle jusque dans la notification navigateur.
ALTER TABLE "Notification" ADD COLUMN "messageKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "params" JSONB;

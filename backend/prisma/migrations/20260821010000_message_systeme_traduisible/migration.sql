-- Messages de service de la messagerie : la phrase était écrite en français EN BASE
-- (« a rejoint la conversation »), donc servie telle quelle à tous les lecteurs et
-- impossible à retraduire après coup. On enregistre désormais la clé i18n et ses
-- variables ; `body` garde la phrase (en anglais pour les nouvelles lignes) et sert de
-- repli aux messages antérieurs, qui n'ont pas de clé.
ALTER TABLE "ChatMessage" ADD COLUMN "systemKey" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "systemVars" JSONB;

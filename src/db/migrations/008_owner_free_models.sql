-- Owner override for AI-gateway models whose price OmniRoute does not publish.
-- The owner (on the PC only) personally confirms that a specific model is free. It never applies to a model that has a price,
-- to routing-style names (auto, combos, fallbacks), or to any provider other than a gateway.
CREATE TABLE owner_free_models (
  provider_id  TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, model_id)
);

-- Set by the platform at refresh time: true only when the single reason a gateway model is blocked is that no price was listed.
ALTER TABLE llm_models ADD COLUMN owner_overridable INTEGER NOT NULL DEFAULT 0 CHECK (owner_overridable IN (0, 1));

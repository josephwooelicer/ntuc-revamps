import { NewsAggregatorConnector } from "../connectors/newsAggregatorConnector.js";
import { SingstatConnector } from "../connectors/singstatConnector.js";
import { MomConnector } from "../connectors/momConnector.js";
import { UraConnector } from "../connectors/uraConnector.js";
import { AcraConnector } from "../connectors/acraConnector.js";
import { EGazetteConnector } from "../connectors/egazetteConnector.js";
import { RedditSingaporeConnector } from "../connectors/redditSingaporeConnector.js";
import { HardwarezoneConnector } from "../connectors/hardwarezoneConnector.js";
import { MasConnector } from "../connectors/masConnector.js";
import { StbConnector } from "../connectors/stbConnector.js";
import { MycareersfutureConnector } from "../connectors/mycareersfutureConnector.js";
import { SgxConnector } from "../connectors/sgxConnector.js";
import { GoogleTrendsConnector } from "../connectors/googleTrendsConnector.js";
import { WorldBankConnector } from "../connectors/worldBankConnector.js";
import { FredConnector } from "../connectors/fredConnector.js";
import { SingaporeCustomsConnector } from "../connectors/singaporeCustomsConnector.js";
import { JobstreetConnector } from "../connectors/jobstreetConnector.js";
import { LinkedinJobsConnector } from "../connectors/linkedinJobsConnector.js";
import { SkillsfutureConnector } from "../connectors/skillsfutureConnector.js";
import { GoogleMapsConnector } from "../connectors/googleMapsConnector.js";
import { GoogleReviewsConnector } from "../connectors/googleReviewsConnector.js";
import { GlassdoorConnector } from "../connectors/glassdoorConnector.js";
import { LayoffsFyiConnector } from "../connectors/layoffFyiConnector.js";

export function listSources(db) {
  return db
    .prepare(
      `SELECT id, name, source_type, access_mode, category, reliability_weight, is_active, supports_backfill
       FROM data_source
       ORDER BY name`
    )
    .all();
}

export function getSourceById(db, sourceId) {
  return db
    .prepare(
      `SELECT id, name, source_type, access_mode, category, reliability_weight, is_active, supports_backfill
       FROM data_source
       WHERE id = ?`
    )
    .get(sourceId);
}

export function createSource(db, body) {
  const {
    id,
    name,
    sourceType,
    accessMode,
    category,
    reliabilityWeight,
    supportsBackfill
  } = body;

  if (!id || !name || !sourceType || !accessMode) {
    throw new Error("Missing required fields: id, name, sourceType, accessMode");
  }

  db
    .prepare(
      `INSERT INTO data_source (
          id, name, source_type, access_mode, category, reliability_weight, supports_backfill
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name,
      sourceType,
      accessMode,
      category || "general",
      reliabilityWeight == null ? 0.7 : Number(reliabilityWeight),
      supportsBackfill ? 1 : 0
    );

  return getSourceById(db, id);
}

export function connectorForSource(source) {
  if (source.id === "src-singstat") {
    return new SingstatConnector(source);
  }

  if (source.id === "src-mas") {
    return new MasConnector(source);
  }

  if (source.id === "src-worldbank") {
    return new WorldBankConnector(source);
  }

  if (source.id === "src-fred") {
    return new FredConnector(source);
  }

  if (source.id === "src-stb") {
    return new StbConnector(source);
  }

  if (source.id === "src-skillsfuture") {
    return new SkillsfutureConnector(source);
  }

  if (source.id === "src-singapore-customs") {
    return new SingaporeCustomsConnector(source);
  }

  if (source.id === "src-mom") {
    return new MomConnector(source);
  }

  if (source.id === "src-ura") {
    return new UraConnector(source);
  }

  if (source.id === "src-acra") {
    return new AcraConnector(source);
  }

  if (source.id === "src-egazette") {
    return new EGazetteConnector(source);
  }

  if (source.id === "src-reddit-sg") {
    return new RedditSingaporeConnector(source);
  }

  if (source.id === "src-hardwarezone") {
    return new HardwarezoneConnector(source);
  }

  if (source.id === "src-mycareersfuture") {
    return new MycareersfutureConnector(source);
  }

  if (source.id === "src-jobstreet") {
    return new JobstreetConnector(source);
  }

  if (source.id === "src-linkedin-jobs") {
    return new LinkedinJobsConnector(source);
  }

  if (source.id === "src-sgx") {
    return new SgxConnector(source);
  }

  if (source.id === "src-google-trends") {
    return new GoogleTrendsConnector(source);
  }

  if (source.id === "src-google-maps") {
    return new GoogleMapsConnector(source);
  }

  if (source.id === "src-google-reviews") {
    return new GoogleReviewsConnector(source);
  }

  if (source.id === "src-glassdoor") {
    return new GlassdoorConnector(source);
  }

  if (source.id === "src-layoffs-fyi") {
    return new LayoffsFyiConnector(source);
  }

  if (source.id === "src-news") {
    return new NewsAggregatorConnector(source);
  }

  return null;
}

function toIsoDay(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function enumerateDateRange(start, end) {
  const values = [];
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);

  for (let cursor = startDate; cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    values.push(cursor.toISOString().slice(0, 10));
  }

  return values;
}

function buildSampleNewsItems(day, sourceId) {
  return [
    {
      externalId: `${sourceId}-${day}-fnb-cost-pressure`,
      publishedAt: `${day}T02:00:00.000Z`,
      title: `Retail rental pressure rises for F&B operators (${day})`,
      url: `https://example.local/news/${day}/fnb-rentals`,
      content: `Simulated historical article for ${day}: F&B operators report sustained rental pressure and weaker margins.`
    },
    {
      externalId: `${sourceId}-${day}-tech-hiring-slowdown`,
      publishedAt: `${day}T05:30:00.000Z`,
      title: `Tech hiring signals soften in Singapore (${day})`,
      url: `https://example.local/news/${day}/tech-hiring`,
      content: `Simulated historical article for ${day}: multiple firms announced slower hiring and project deferrals.`
    }
  ];
}

export class NewsAggregatorConnector {
  source: any;

  constructor(source) {
    this.source = source;
  }

  pull(range, cursor = null, _options = {}) {
    const start = toIsoDay(range?.start);
    const end = toIsoDay(range?.end);
    if (!start || !end || start > end) {
      throw new Error("Invalid range. Expected ISO dates where range.start <= range.end.");
    }

    const days = enumerateDateRange(start, end);
    const offset = Number(cursor || 0);
    const pageSize = 10;
    const pagedDays = days.slice(offset, offset + pageSize);

    const documents = pagedDays.flatMap((day) => buildSampleNewsItems(day, this.source.id));
    const nextCursor = offset + pageSize < days.length ? String(offset + pageSize) : null;

    return {
      documents,
      nextCursor
    };
  }
}

import * as cheerio from "cheerio";

const SOURCE_URL = "https://www.statistik.at/medien/pressemitteilungen";
const BASE_URL = "https://www.statistik.at";
const FEED_TITLE = "Statistik Austria – Pressemitteilungen";
const FEED_DESCRIPTION =
  "Pressemitteilungen der Statistik Austria";

function parseDate(ddmmyyyy) {
  const [day, month, year] = ddmmyyyy.split(".");
  // Use noon UTC as a neutral time since the exact publication time is unknown
  return new Date(`${year}-${month}-${day}T12:00:00Z`);
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRss(items) {
  const itemsXml = items
    .map(({ title, link, date }) => {
      const pubDate = date.toUTCString();
      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SOURCE_URL}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>de-AT</language>
${itemsXml}
  </channel>
</rss>`;
}

export default async function handler(req, res) {
  const { max_days } = req.query;
  let maxDays = null;
  if (max_days !== undefined) {
    maxDays = Number(max_days);
    if (!Number.isInteger(maxDays) || maxDays < 1) {
      res.status(400).send("max_days must be a positive integer");
      return;
    }
  }

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    res.status(502).send(`Failed to fetch source page (status: ${response.status})`);
    return;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  let items = [];

  $("table.contenttable").each((_, table) => {
    $(table)
      .find("tbody tr")
      .each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;

        const dateText = $(cells[0]).text().trim();
        const anchor = $(cells[1]).find("a").first();
        const title = anchor.text().trim();
        const href = anchor.attr("href");

        if (!dateText || !title || !href) return;

        const link = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        const date = parseDate(dateText);

        if (!isNaN(date.getTime())) {
          items.push({ title, link, date });
        }
      });
  });

  items.sort((a, b) => b.date - a.date);

  if (maxDays !== null) {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - maxDays);
    items = items.filter((item) => item.date >= cutoff);
  }

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  res.status(200).send(buildRss(items));
}

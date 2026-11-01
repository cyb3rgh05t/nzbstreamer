const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseReleaseMetadata, releaseMatchesEpisode } = require("./releaseParser");
const { fileMatchesEpisode } = require("../../utils/parsers");

const matches = (title, season, episode) =>
  releaseMatchesEpisode(parseReleaseMetadata(title), season, episode);

test("season packs expose all seasons and no episodes", () => {
  const single = parseReleaseMetadata("Show.Name.S01.1080p.BluRay.x264-GRP");
  assert.deepEqual(single.seasons, [1]);
  assert.deepEqual(single.episodes, []);
  assert.equal(single.isSeasonPack, true);
  assert.equal(single.parsedTitleDisplay, "Show Name S01");

  const multi = parseReleaseMetadata("Show.Name.S01-S03.COMPLETE.1080p.BluRay-GRP");
  assert.deepEqual(multi.seasons, [1, 2, 3]);
  assert.equal(multi.isSeasonPack, true);
  assert.equal(multi.complete, true);
  assert.equal(multi.parsedTitleDisplay, "Show Name S01-S03");
});

test("single episodes are not season packs", () => {
  const episode = parseReleaseMetadata("Show.Name.S01E05.1080p.WEB-DL-GRP");
  assert.equal(episode.isSeasonPack, false);
  assert.deepEqual(episode.episodes, [5]);
});

test("multi-episode releases cover every episode", () => {
  assert.equal(matches("Show.Name.S01E01-E03.720p.HDTV", 1, 3), true);
  assert.equal(matches("Show.Name.S01E01E02.720p.HDTV", 1, 2), true);
  assert.equal(matches("Show.Name.S01E01E02.720p.HDTV", 1, 3), false);
});

test("season packs match episodes of their seasons only", () => {
  assert.equal(matches("Show.Name.S01.1080p.BluRay-GRP", 1, 7), true);
  assert.equal(matches("Show.Name.S01.1080p.BluRay-GRP", 2, 7), false);
  assert.equal(matches("Show.Name.S01-S03.1080p.BluRay-GRP", 3, 1), true);
  assert.equal(matches("Show.Name.S01-S03.1080p.BluRay-GRP", 4, 1), false);
  assert.equal(matches("Show.Name.Complete.Series.1080p.HDTV", 5, 5), true);
  assert.equal(matches("Show.Name.1080p.BluRay-GRP", 1, 1), false);
});

test("German Staffel is understood as season", () => {
  const parsed = parseReleaseMetadata("Show Name Staffel 2 German 1080p WEB h264");
  assert.equal(parsed.parsedTitle, "Show Name");
  assert.deepEqual(parsed.seasons, [2]);
  assert.equal(parsed.isSeasonPack, true);
  assert.ok(parsed.languages.includes("de"));
});

test("normal movie and episode releases keep their previous parse", () => {
  const movie = parseReleaseMetadata("Movie.Name.2021.1080p.BluRay.x264-GRP");
  assert.equal(movie.parsedTitle, "Movie Name");
  assert.equal(movie.parsedTitleDisplay, "Movie Name 2021");
  assert.equal(movie.source, null);
  assert.equal(movie.isSeasonPack, false);
  assert.equal(parseReleaseMetadata("Show.Name.S01E01.1080p.WEB-DL-GRP").parsedTitleDisplay, "Show Name S01E01");
});

test("files inside packs are matched across naming styles", () => {
  const wanted = { season: 1, episode: 5 };
  assert.equal(fileMatchesEpisode("Show.Name.S01E05.1080p.mkv", wanted), true);
  assert.equal(fileMatchesEpisode("Show.Name.1x05.720p.mkv", wanted), true);
  assert.equal(fileMatchesEpisode("Show.Name.S01E5.mkv", wanted), true);
  assert.equal(fileMatchesEpisode("Show.Name.S01.E05.mkv", wanted), true);
  assert.equal(fileMatchesEpisode("Show.Name.S01E04E05.mkv", wanted), true);
  assert.equal(fileMatchesEpisode("Show.Name.Season.1.Episode.5.mkv", wanted), true);
  assert.equal(fileMatchesEpisode("Show.Name.S01E06.mkv", wanted), false);
  assert.equal(fileMatchesEpisode("Show.Name.S02E05.mkv", wanted), false);
  assert.equal(fileMatchesEpisode("anything.mkv", null), true);
});

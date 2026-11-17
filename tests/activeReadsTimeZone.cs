#:project ../vendor/nzbdavex/backend/NzbWebDAV.csproj

using System.Reflection;
using NzbWebDAV.Api.Controllers.GetOverviewStats;
using NzbWebDAV.Services;

var controller = typeof(GetOverviewStatsController);
var localDayStart = controller.GetMethod("LocalDayStart", BindingFlags.NonPublic | BindingFlags.Static)!;
var buildSeries = controller.GetMethod("BuildActiveReadsByDay", BindingFlags.NonPublic | BindingFlags.Static)!;
var berlin = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");
var utc = TimeZoneInfo.Utc;

static long Timestamp(string value) => DateTimeOffset.Parse(value).ToUnixTimeMilliseconds();
static void Expect(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}
long Start(string date, TimeZoneInfo zone) =>
    (long)localDayStart.Invoke(null, new object[] { DateTime.Parse(date), zone })!;

Expect(Start("2026-03-29", berlin) == Timestamp("2026-03-28T23:00:00Z"), "Berlin spring day starts at 23:00 UTC");
Expect(Start("2026-03-30", berlin) - Start("2026-03-29", berlin) == 23 * 60 * 60 * 1000L, "Berlin spring day is 23 hours");
Expect(Start("2026-10-26", berlin) - Start("2026-10-25", berlin) == 25 * 60 * 60 * 1000L, "Berlin autumn day is 25 hours");

var intervals = new List<(long StartedAt, long EndedAt)>
{
    (Timestamp("2026-03-28T22:30:00Z"), Timestamp("2026-03-28T23:30:00Z")),
    (Timestamp("2026-03-28T23:10:00Z"), Timestamp("2026-03-28T23:20:00Z")),
};
List<GetOverviewStatsResponse.ActiveReadsDay> Series(TimeZoneInfo zone) =>
    (List<GetOverviewStatsResponse.ActiveReadsDay>)buildSeries.Invoke(null, new object[] {
        intervals, new List<ActiveReadRegistry.Entry>(), Timestamp("2026-03-30T12:00:00Z"), 30, zone,
    })!;
var berlinDays = Series(berlin);
Expect(berlinDays.Select(day => (day.Day, day.Peak)).SequenceEqual(new[] {
    ("2026-03-28", 1), ("2026-03-29", 2), ("2026-03-30", 0),
}), "Berlin sessions must split at local midnight and retain overlapping peak");
var utcDays = Series(utc);
Expect(utcDays[0].Day == "2026-03-28" && utcDays[0].Peak == 2, "UTC groups the overlap on March 28");

Console.WriteLine("Active reads time-zone tests passed.");
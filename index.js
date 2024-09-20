const { Telegraf } = require("telegraf");
const axios = require("axios");
const process = require("process");

// Your Bot API Token and Chat ID
const API_TOKEN = "6945220081:AAGeGPKdXjuKK2VCbXw2fJtYRgYUYn6dYSY";
const ChatID = "1029681168";

// Initialize bot
const bot = new Telegraf(API_TOKEN);

// Fetch cricket match details from the API
async function fetchMatches() {
  try {
    const response = await axios.get(
      "https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?latest=true"
    );
    const matches = response.data.matches.filter(
      (match) => match.status === "Live"
    );

    return matches.map((match, index) => ({
      id: index + 1,
      matchName: match.slug,
      scribeId: match.scribeId,
      seriesId: match.series.objectId,
      seriesSlug: match.series.slug,
    }));
  } catch (error) {
    console.error("Error fetching match details:", error);
    return [];
  }
}

// Fetch detailed score and ball-by-ball updates
async function fetchMatchDetails(seriesId, matchId) {
  try {
    const response = await axios.get(
      `https://hs-consumer-api.espncricinfo.com/v1/pages/match/details?seriesId=${seriesId}&matchId=${matchId}&latest=true`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching match details:", error);
    return null;
  }
}

// Format batsman data
function formatBatsmanData(data) {
  return data.supportInfo.liveSummary.batsmen
    .map(
      (batsman) =>
        `${batsman.player.battingName} ${batsman.runs}(${batsman.balls})`
    )
    .join(" || ");
}

// Format bowler data
function formatBowlerData(data) {
  return data.supportInfo.liveSummary.bowlers
    .map(
      (bowler) =>
        `${bowler.player.battingName} ${bowler.overs}-${bowler.maidens}-${bowler.conceded}-${bowler.wickets}`
    )
    .join(" || ");
}

// Poll for recent ball commentary and updates
let cache = [];

async function pollForUpdates(ChatID, seriesId, matchId) {
  // Polling duration (set this to a certain time, e.g., 5 minutes)
  const pollingDuration = 5 * 60 * 1000; // 5 minutes
  const pollingEndTime = Date.now() + pollingDuration;

  // Continue polling until time runs out
  while (Date.now() < pollingEndTime) {
    const matchData = await fetchMatchDetails(seriesId, matchId);
    if (matchData && matchData.recentBallCommentary) {
      const recentBall = matchData.recentBallCommentary.ballComments[0];

      const oversActual = recentBall.oversActual;

      // Only send updates if not already sent
      if (!cache.includes(oversActual)) {
        cache.push(oversActual);
        if (cache.length > 10) cache.shift(); // Limit cache size to last 10 balls

        const isFour = recentBall.isFour ? "Four Runs " : "";
        const isSix = recentBall.isSix ? "SIX Runs " : "";
        const isWicket = recentBall.isWicket ? "OUT " : "";
        const runs =
          !isFour && !isSix && !isWicket ? `${recentBall.totalRuns} Runs` : "";
        const recentMessage = `${oversActual} ${recentBall.title}, ${isFour}${isSix}${isWicket}${runs}`;

        await bot.telegram.sendMessage(ChatID, recentMessage);

        // Send over information at the end of an over
        if (oversActual.toString().includes(".6")) {
          const batsmen = formatBatsmanData(matchData);
          const bowlers = formatBowlerData(matchData);

          const overInfo =
            `${recentBall.over.team.abbreviation} - ${recentBall.over.totalRuns}/${recentBall.over.totalWickets}\n` +
            `${recentBall.over.overRuns} runs * ${recentBall.over.overWickets} wickets\n` +
            `Batting: ${batsmen}\nBowling: ${bowlers}`;

          await bot.telegram.sendMessage(ChatID, overInfo);
        }
      }
    }

    // Wait before polling again (use a smaller interval like 30 seconds)
    await new Promise((resolve) => setTimeout(resolve, 30000)); // 30 seconds
  }

  // End polling after polling duration
  await bot.telegram.sendMessage(ChatID, "Polling for updates has ended.");
}

// Command to start the bot and display live matches
bot.start(async (ctx) => {
  const matches = await fetchMatches();

  if (matches.length > 0) {
    let message = "Live Matches:\n";
    matches.forEach((match) => {
      message += `live${match.id} --> ${match.matchName}\n`;
    });

    await ctx.reply(message);
  } else {
    await ctx.reply("No live matches available at the moment.");
  }
});

// Handle messages to get live updates
bot.on("text", async (ctx) => {
  const message = ctx.message.text.trim().toLowerCase();

  if (message.startsWith("live")) {
    const matchNumber = parseInt(message.replace("live", ""), 10);

    const matches = await fetchMatches();

    if (matchNumber > 0 && matchNumber <= matches.length) {
      const selectedMatch = matches[matchNumber - 1];

      const liveMatchUrl = `https://www.espncricinfo.com/series/${selectedMatch.seriesSlug}-${selectedMatch.seriesId}/${selectedMatch.matchName}-${selectedMatch.scribeId}/live-cricket-score`;
      console.log(liveMatchUrl); // Log for debugging

      await ctx.reply(`Fetching updates for ${selectedMatch.matchName}...`);
      await pollForUpdates(
        ctx.chat.id,
        selectedMatch.seriesId,
        selectedMatch.scribeId
      );
    } else {
      await ctx.reply(
        "Invalid match number. Please select a valid live match."
      );
    }
  } else {
    await ctx.reply(
      'Send "live" followed by the match number (e.g., "live1") to get updates.'
    );
  }
});

// Start the bot
bot.launch();

// Handle graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

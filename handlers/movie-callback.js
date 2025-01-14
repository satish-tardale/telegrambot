const handleCallbackQuery = async (bot, callbackQuery) => {

  console.log("hiiiiiiiiiiiiii call back handlecallbackquery is executed");
  try {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    // Check if it's a download request (data will be in format "d:fileId")
    if (data && data.startsWith('d:')) {
      const shortFileId = data.slice(2); // Remove 'd:' prefix
      const fullFileId = await getFullFileIdFromDatabase(shortFileId);
      
      if (fullFileId) {
        await bot.sendDocument(chatId, fullFileId);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Downloading..." });
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "File not found" });
      }
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Invalid request" });
    }
  } catch (error) {
    console.error('Error processing callback query:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred" });
  }
};

// Database query function
const getFullFileIdFromDatabase = async (shortId) => {
  try {
    // Assuming you have a MongoDB collection reference as 'Posts'
    const post = await Posts.findOne({
      $or: [
        { file_id: { $regex: shortId + '$' } },
        { file_ref: { $regex: shortId + '$' } }
      ]
    });

    return post ? (post.file_id || post.file_ref) : null;
  } catch (error) {
    console.error("Error retrieving file ID:", error);
    return null;
  }
};

module.exports = handleCallbackQuery;
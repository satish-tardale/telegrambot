const handleCallbackQuery = async (bot, callbackQuery, fileCache) => {
    console.log('Callback data received:', callbackQuery.data);
  
    const { data } = callbackQuery; // The callback data
  
    try {
      // Directly use the callback data as the uniqueId
      const fileId = fileCache.get(data); // Retrieve fileId from cache using uniqueId
  
      if (fileId) {
        await bot.sendDocument(callbackQuery.message.chat.id, fileId);
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "File not found in cache!" });
      }
    } catch (error) {
      console.error('Error processing callback query:', error);
      await bot.answerCallbackQuery(callbackQuery.id, { text: "An error occurred." });
    }
  };
  
  module.exports = handleCallbackQuery;
  
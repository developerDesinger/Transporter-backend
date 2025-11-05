// Logger utility for consistent logging across the application

const logLevels = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

class Logger {
  static info(message, data = null) {
    console.log(`\nℹ️  [${new Date().toISOString()}] INFO: ${message}`);
    if (data) {
      console.log(`📋 Data:`, JSON.stringify(data, null, 2));
    }
    console.log('─'.repeat(50));
  }

  static warn(message, data = null) {
    console.warn(`\n⚠️  [${new Date().toISOString()}] WARN: ${message}`);
    if (data) {
      console.warn(`📋 Data:`, JSON.stringify(data, null, 2));
    }
    console.warn('─'.repeat(50));
  }

  static error(message, error = null) {
    console.error(`\n❌ [${new Date().toISOString()}] ERROR: ${message}`);
    if (error) {
      console.error(`🔍 Error Details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }
    console.error('─'.repeat(50));
  }

  static debug(message, data = null) {
    if (process.env.NODE_ENV === 'DEVELOPMENT') {
      console.log(`\n🐛 [${new Date().toISOString()}] DEBUG: ${message}`);
      if (data) {
        console.log(`📋 Data:`, JSON.stringify(data, null, 2));
      }
      console.log('─'.repeat(50));
    }
  }

  static apiRequest(method, url, headers = {}, body = null, query = null) {
    console.log(`\n🚀 [${new Date().toISOString()}] API REQUEST: ${method} ${url}`);
    console.log(`📋 Headers:`, JSON.stringify(headers, null, 2));
    if (body) console.log(`📦 Body:`, JSON.stringify(body, null, 2));
    if (query) console.log(`🔍 Query:`, JSON.stringify(query, null, 2));
    console.log('─'.repeat(80));
  }

  static apiResponse(method, url, statusCode, response, duration) {
    console.log(`✅ [${new Date().toISOString()}] API RESPONSE: ${method} ${url} - ${statusCode} (${duration}ms)`);
    console.log(`📤 Response:`, typeof response === 'string' ? response : JSON.stringify(response, null, 2));
    console.log('─'.repeat(80));
  }

  static database(operation, collection, query = null, result = null) {
    console.log(`\n🗄️  [${new Date().toISOString()}] DATABASE: ${operation} on ${collection}`);
    if (query) console.log(`🔍 Query:`, JSON.stringify(query, null, 2));
    if (result) console.log(`📋 Result:`, JSON.stringify(result, null, 2));
    console.log('─'.repeat(50));
  }

  static aiRequest(prompt, context = null) {
    console.log(`\n🤖 [${new Date().toISOString()}] AI REQUEST`);
    console.log(`💬 Prompt:`, prompt);
    if (context) console.log(`📋 Context:`, JSON.stringify(context, null, 2));
    console.log('─'.repeat(50));
  }

  static aiResponse(response, duration) {
    console.log(`🤖 [${new Date().toISOString()}] AI RESPONSE (${duration}ms)`);
    console.log(`💬 Response:`, response);
    console.log('─'.repeat(50));
  }

  static userAction(userId, action, details = null) {
    console.log(`\n👤 [${new Date().toISOString()}] USER ACTION: User ${userId} - ${action}`);
    if (details) console.log(`📋 Details:`, JSON.stringify(details, null, 2));
    console.log('─'.repeat(50));
  }
}

module.exports = Logger; 
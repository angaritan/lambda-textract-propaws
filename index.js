const { handler } = require('./src/handler/textractLotesPDF.js');

const httpMethod = {
  default: (event, context) => handler(event, context),
};

const lambdaHandler = async (event, context) => {
  console.log('Received context:', JSON.stringify(context, null, 2));
  const method = httpMethod['default'];
  return method(event);
};

module.exports = {
  lambdaHandler,
};
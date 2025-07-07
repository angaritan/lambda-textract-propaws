const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { TextractClient, StartDocumentAnalysisCommand } = require('@aws-sdk/client-textract');


jest.mock('../../src/handler/textractLotesPDF.js', () => {
  const original = jest.requireActual('../../src/handler/textractLotesPDF.js');
  return {
    ...original,
    sleep: jest.fn(() => Promise.resolve())
  };
});

const { handler, sleep } = require('../../src/handler/textractLotesPDF.js');

const s3Mock = mockClient(S3Client);
const textractMock = mockClient(TextractClient);

beforeEach(() => {
  s3Mock.reset();
  textractMock.reset();
  process.env.INPUT_BUCKET = 'test-input';
  process.env.SNS_TOPIC_ARN = 'arn:sns:123:topic';
  process.env.TEXTRACT_ROLE_ARN = 'arn:iam::123:role/textract';
});

test('procesa 25 archivos PDF en lotes de 10', async () => {
  // Mocks
  const pdfs = Array.from({ length: 25 }, (_, i) => ({ Key: `doc${i}.pdf` }));
  s3Mock.on(ListObjectsV2Command).resolves({ Contents: pdfs });
  textractMock.on(StartDocumentAnalysisCommand).resolves({ JobId: 'abc' });

  const result = await handler();
  

  expect(textractMock.calls().length).toBe(25); // 25 archivos procesados
  //expect(sleep).toHaveBeenCalledTimes(2); // Entre 3 lotes → 2 pausas
  expect(result.statusCode).toBe(200);
});

test('salta archivos no PDF', async () => {
  s3Mock.on(ListObjectsV2Command).resolves({
    Contents: [
      { Key: 'doc1.pdf' },
      { Key: 'readme.txt' },
      { Key: 'doc2.pdf' }
    ]
  });

  textractMock.on(StartDocumentAnalysisCommand).resolves({ JobId: 'abc' });

  const result = await handler()

  expect(textractMock.calls().length).toBe(2); // Solo 2 PDFs válidos
  expect(result.statusCode).toBe(200);
});

test('maneja errores de StartDocumentAnalysis y continúa', async () => {
  s3Mock.on(ListObjectsV2Command).resolves({
    Contents: [{ Key: 'doc1.pdf' }, { Key: 'doc2.pdf' }]
  });

  textractMock
    .on(StartDocumentAnalysisCommand)
    .resolvesOnce({ JobId: 'ok' })
    .rejectsOnce(new Error('Textract error'));

  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await handler();

  expect(textractMock.calls().length).toBe(2);
  expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(' Error al iniciar análisis de doc2.pdf:'), expect.anything());
  consoleSpy.mockRestore();
});

test('no hace nada si no hay PDFs', async () => {
  s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'image.jpg' }] });

  const result = await handler();

  expect(textractMock.calls().length).toBe(0);
  expect(result.body).toContain('No se encontraron archivos PDF para procesar.');
});

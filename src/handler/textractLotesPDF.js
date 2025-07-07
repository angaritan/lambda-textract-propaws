const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { TextractClient, StartDocumentAnalysisCommand } = require('@aws-sdk/client-textract');

const s3 = new S3Client();
const textract = new TextractClient();

//const bucket = process.env.INPUT_BUCKET; 
//const snsTopic = process.env.SNS_TOPIC_ARN;
//const roleArn = process.env.TEXTRACT_ROLE_ARN;
const bucket = 'may-int-dev-textract-input'; 
const snsTopic = 'arn:aws:sns:us-east-1:381492000646:SNSTextractProcessv1';
const roleArn = "arn:aws:iam::381492000646:role/may-lmd-clients-procimg-textract-pj-role";

// Ajustar este valor según  necesidades y límites
const BATCH_SIZE = 10;
const DELAY_MS = 2000; // 2 segundos entre lotes

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const handler = async () => {
  const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  const pdfs = list.Contents.filter(obj => obj.Key.endsWith('.pdf'));

  console.log(`Total de PDFs encontrados: ${pdfs.length}`);

  if (!pdfs.length) {
    console.log('No se encontraron archivos PDF para procesar.');
    return {
      statusCode: 200,
      body: 'No se encontraron archivos PDF para procesar.'
    };
  }

  // Divide en lotes
  for (let i = 0; i < pdfs.length; i += BATCH_SIZE) {
    const batch = pdfs.slice(i, i + BATCH_SIZE);

    console.log(`Procesando lote ${Math.floor(i / BATCH_SIZE) + 1} con ${batch.length} archivos`);

    const startAnalysisPromises = batch.map(async (pdf) => {
      const command = new StartDocumentAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: pdf.Key } },
        FeatureTypes: ['TABLES', 'FORMS'],
        NotificationChannel: {
          SNSTopicArn: snsTopic,
          RoleArn: roleArn
        }
      });

      try {
        const result = await textract.send(command);
        console.log(` Textract iniciado para ${pdf.Key} - JobId: ${result.JobId}`);
      } catch (error) {
        console.error(` Error al iniciar análisis de ${pdf.Key}:`, error.message);
      }
    });

    // Espera a que el lote actual termine
    await Promise.all(startAnalysisPromises);

    // Espera entre lotes
    if (i + BATCH_SIZE < pdfs.length) {
      console.log(` Esperando ${DELAY_MS / 1000}s antes del siguiente lote...`);
      await sleep(DELAY_MS);
    }
  }

  return {
    statusCode: 200,
    body: `Análisis iniciado para ${pdfs.length} archivos PDF en lotes de ${BATCH_SIZE}.`
  };
};
module.exports = {
    handler
};
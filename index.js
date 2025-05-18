const AWS = require('aws-sdk');

const  {  CreateQueueCommand, GetQueueAttributesCommand, GetQueueUrlCommand, 
          SetQueueAttributesCommand, DeleteQueueCommand, ReceiveMessageCommand, 
          DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const  { CreateTopicCommand, SubscribeCommand, DeleteTopicCommand } = require('@aws-sdk/client-sns');
const  { SQSClient } = require('@aws-sdk/client-sqs');
const  { SNSClient } = require('@aws-sdk/client-sns');
const  { TextractClient, StartDocumentTextDetectionCommand, StartDocumentAnalysisCommand, 
         GetDocumentAnalysisCommand, GetDocumentTextDetectionCommand, DocumentMetadata } = require('@aws-sdk/client-textract');
const  { stdout } = require('process');
const  {fromIni} = require('@aws-sdk/credential-providers');

//require('dotenv').config();
// Set the AWS Region.
const REGION = "us-east-1"; //e.g. "us-east-1"
const profileName = "default";

const textractClient = new TextractClient();
const sqsClient = new SQSClient({});
const snsClient = new SNSClient({});

  // Set bucket and video variables
  var bucket = "bucket-name";                                                                                                                  
  var documentName = "document-name";
  const roleArn = "arn:aws:iam::381492000646:role/may-lmd-clients-procimg-textract-pj-role";
  const processType = "ANALYSIS";
  var startJobId = "";
  
  var ts = Date.now();
  const snsTopicName = "AmazonTextractProcess" + ts;
  const snsTopicParams = {Name: snsTopicName}
  const sqsQueueName = "AmazonTextractQueue-" + ts;

   // Set the parameters
   const sqsParams = {
    QueueName: sqsQueueName, //SQS_QUEUE_URL
    Attributes: {
      DelaySeconds: "60", // Number of seconds delay.
      MessageRetentionPeriod: "86400", // Number of seconds delay.
    },
  };


const handler  = async (event) => {

  var sqsAndTopic = await createTopicandQueue();

  let filesProcessed = event.Records.map( async (record) => {
      bucket = record.s3.bucket.name;
      documentName = record.s3.object.key;

    // Get file from S3
    var params = {
        Bucket: bucket,
        Key: documentName
    };
    //let inputData = await s3.getObject(params).promise();

    console.log("Parametros de entrada:  ", params);
    
    var process = await processDocumment(processType, bucket, documentName, roleArn, sqsAndTopic[0], sqsAndTopic[1])
    
  });
  await Promise.all(filesProcessed);
  var deleteResults = await deleteTopicAndQueue(sqsAndTopic[0], sqsAndTopic[1]);
  console.log("Realizacion de ejecucion de procesamiento de los archivos pdf");
  return "done";

}

// Process a document based on operation type
const processDocumment = async (type, bucket, videoName, roleArn, sqsQueueUrl, snsTopicArn) =>
  {
  try
  {
      // Set job found and success status to false initially
    var jobFound = false;
    var succeeded = false;
    var dotLine = 0;
    var processType = type;
    var validType = false;

    console.log("Bucket:  ", bucket);
    console.log("Video:  ", videoName);
  
    if (processType == "DETECTION"){
      var response = await textractClient.send(new StartDocumentTextDetectionCommand({DocumentLocation:{S3Object:{Bucket:bucket, Name:videoName}}, 
        NotificationChannel:{RoleArn: roleArn, SNSTopicArn: snsTopicArn}}))
      console.log("Processing type Detection con response:  "+ response)
      validType = true
    }

    console.log("Bucket analisis:  ", bucket);
    console.log("Video analisis:  ", videoName);
   try{
        if (processType == "ANALYSIS"){
          var response = await textractClient.send(new StartDocumentAnalysisCommand({DocumentLocation:{S3Object:{Bucket:bucket, Name:videoName}}, 
            FeatureTypes: ["TABLES", "FORMS"], NotificationChannel:{RoleArn: roleArn, SNSTopicArn: snsTopicArn}}))
          console.log("Processing type: Analysis", response )
          validType = true
        } 
    
  }catch (error ) {
    console.log( 'error: ', error)
  } 
      
    if (validType == false){
        console.log("Invalid processing type. Choose Detection or Analysis.")
        return
    }
  // while not found, continue to poll for response
  console.log(`Start Job ID: ${response.JobId}`)
  startJobId = response.JobId;
  while (jobFound == false){
    var sqsReceivedResponse = await sqsClient.send(new ReceiveMessageCommand({QueueUrl:sqsQueueUrl, 
      WaitTimeSeconds:10, MaxNumberOfMessages:10}));
      console.log("SQS Response:",sqsReceivedResponse);
      console.log("Messages:",sqsReceivedResponse?.Messages);
    if (sqsReceivedResponse){
      var responseString = JSON.stringify(sqsReceivedResponse)
      if (!responseString.includes('Body')){
        if (dotLine < 40) {
          console.log('.')
          dotLine = dotLine + 1
        }else {
          console.log('')
          dotLine = 0 
        };
        stdout.write('', () => {
          console.log('');
        });
        await new Promise(resolve => setTimeout(resolve, 10000));
        if (sqsReceivedResponse && sqsReceivedResponse.Messages && sqsReceivedResponse.Messages.length > 0) {
            for (const message of sqsReceivedResponse.Messages) {
                // tu lógica
              console.log('Mensaje existente: '+ message);
            }
        } else {
            console.log("No hay mensajes aún.");
        }
        continue
      }
    }
  
      // Once job found, log Job ID and return true if status is succeeded
        console.log("Retrieved messages:  pasa por todos los mensajes lanzados a la sqs. ")
        console.log( sqsReceivedResponse)
        console.log( String(startJobId))
      for (var message of sqsReceivedResponse.Messages){
          console.log("Retrieved messages: Mensajes resuperados para procesar desde sqs.")
          var notification = JSON.parse(message.Body)
          var rekMessage = JSON.parse(notification.Message)
          var messageJobId = rekMessage.JobId
          if (String(rekMessage.JobId).includes(String(startJobId))){
              console.log('Matching job found: encontrado Job para mostrar información.')
              console.log(rekMessage.JobId)
              jobFound = true
              // GET RESUlTS FUNCTION HERE
              var operationResults = await GetResults(processType, rekMessage.JobId)
              //GET RESULTS FUMCTION HERE
              console.log(rekMessage.Status)
          if (String(rekMessage.Status).includes(String("SUCCEEDED"))){
              succeeded = true
              console.log("Job processing succeeded.")
              var sqsDeleteMessage = await sqsClient.send(new DeleteMessageCommand({QueueUrl:sqsQueueUrl, ReceiptHandle:message.ReceiptHandle}));
          }
          }else{
          console.log("Provided Job ID did not match returned ID.")
          var sqsDeleteMessage = await sqsClient.send(new DeleteMessageCommand({QueueUrl:sqsQueueUrl, ReceiptHandle:message.ReceiptHandle}));
          }
      }
  
  console.log("Done!")
  }
  }catch (err) {
      console.log("Error", err);
    }
  }


// Create the SNS topic and SQS Queue
const createTopicandQueue = async () => {
    try {
      // Create SNS topic
      const topicResponse = await snsClient.send(new CreateTopicCommand(snsTopicParams));
      const topicArn = topicResponse.TopicArn
      console.log("Success", topicResponse);
      // Create SQS Queue
      const sqsResponse = await sqsClient.send(new CreateQueueCommand(sqsParams));
      console.log("Success", sqsResponse);
      const sqsQueueCommand = await sqsClient.send(new GetQueueUrlCommand({QueueName: sqsQueueName}))
      const sqsQueueUrl = sqsQueueCommand.QueueUrl
      const attribsResponse = await sqsClient.send(new GetQueueAttributesCommand({QueueUrl: sqsQueueUrl, AttributeNames: ['QueueArn']}))
      const attribs = attribsResponse.Attributes
      console.log(attribs)
      const queueArn = attribs.QueueArn
      // subscribe SQS queue to SNS topic
      const subscribed = await snsClient.send(new SubscribeCommand({TopicArn: topicArn, Protocol:'sqs', Endpoint: queueArn}))
      console.log('Respuesta de SubscribeCommand: '+ JSON.stringify(subscribed))
      const policy = {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "MyPolicy",
              Effect: "Allow",
              Principal: {AWS: "*"},
              Action: "SQS:SendMessage",
              Resource: queueArn,
              Condition: {
                ArnEquals: {
                  'aws:SourceArn': topicArn
                }
              }
            }
          ]
      };
    
      const response = sqsClient.send(new SetQueueAttributesCommand({QueueUrl: sqsQueueUrl, Attributes: {Policy: JSON.stringify(policy)}}))
      console.log('Respuesta de SetQueueAttributesCommand: '+ JSON.stringify(response))
      console.log(sqsQueueUrl, topicArn)
      return [sqsQueueUrl, topicArn]
    
    } catch (err) {
      console.log("Error", err);
    
    }
  }

  const deleteTopicAndQueue = async (sqsQueueUrlArg, snsTopicArnArg) => {
    const deleteQueue = await sqsClient.send(new DeleteQueueCommand({QueueUrl: sqsQueueUrlArg}));
    const deleteTopic = await snsClient.send(new DeleteTopicCommand({TopicArn: snsTopicArnArg}));
    console.log("Successfully deleted.")
    }
    
    const displayBlockInfo = async (block) => {
    console.log(`Block ID: ${block.Id}`)
    console.log(`Block Type: ${block.BlockType}`)
    if (String(block).includes(String("EntityTypes"))){
        console.log(`EntityTypes: ${block.EntityTypes}`)
    }
    if (String(block).includes(String("Text"))){
        console.log(`EntityTypes: ${block.Text}`)
    }
    if (!String(block.BlockType).includes('PAGE')){
        console.log(`Confidence: ${block.Confidence}`)
    }
    console.log(`Page: ${block.Page}`)
    if (String(block.BlockType).includes("CELL")){
        console.log("Cell Information")
        console.log(`Column: ${block.ColumnIndex}`)
        console.log(`Row: ${block.RowIndex}`)
        console.log(`Column Span: ${block.ColumnSpan}`)
        console.log(`Row Span: ${block.RowSpan}`)
        if (String(block).includes("Relationships")){
            console.log(`Relationships: ${block.Relationships}`)
        }
    }
    
    console.log("Geometry")
    console.log(`Bounding Box: ${JSON.stringify(block.Geometry.BoundingBox)}`)
    console.log(`Polygon: ${JSON.stringify(block.Geometry.Polygon)}`)
    
    if (String(block.BlockType).includes('SELECTION_ELEMENT')){
      console.log('Selection Element detected:')
      if (String(block.SelectionStatus).includes('SELECTED')){
        console.log('Selected')
      } else {
        console.log('Not Selected')
      }
    
    }
    }
    
    const GetResults = async (processType, JobID) => {
    
    var maxResults = 1000
    var paginationToken = null
    var finished = false
    
    while (finished == false){
      var response = null
      if (processType == 'ANALYSIS'){
        if (paginationToken == null){
          response = textractClient.send(new GetDocumentAnalysisCommand({JobId:JobID, MaxResults:maxResults}))
      
        }else{
          response = textractClient.send(new GetDocumentAnalysisCommand({JobId:JobID, MaxResults:maxResults, NextToken:paginationToken}))
        }
      }
        
      if(processType == 'DETECTION'){
        if (paginationToken == null){
          response = textractClient.send(new GetDocumentTextDetectionCommand({JobId:JobID, MaxResults:maxResults}))
      
        }else{
          response = textractClient.send(new GetDocumentTextDetectionCommand({JobId:JobID, MaxResults:maxResults, NextToken:paginationToken}))
        }
      }
    
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log("Detected Documented Text")
      console.log(response)
      //console.log(Object.keys(response))
      console.log(typeof(response))
      var blocks = (await response).Blocks
      console.log(blocks)
      console.log(typeof(blocks))
      var docMetadata = (await response).DocumentMetadata
      var blockString = JSON.stringify(blocks)
      var parsed = JSON.parse(JSON.stringify(blocks))
      console.log(Object.keys(blocks))
      console.log(`Pages: ${docMetadata.Pages}`)
      blocks.forEach((block)=> {
        displayBlockInfo(block)
        console.log()
        console.log()
      })
    
      //console.log(blocks[0].BlockType)
      //console.log(blocks[1].BlockType)
    
    
      if(String(response).includes("NextToken")){
        paginationToken = response.NextToken
      }else{
        finished = true
      }
    }
    
    };


    module.exports = {
        handler        
    };
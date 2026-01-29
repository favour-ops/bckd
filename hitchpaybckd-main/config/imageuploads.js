const db = require('../models')
const util = require('util')
const cloudinary = require('cloudinary').v2;
// Initialize the app with the service account key and the FCM server key
const admin = require('firebase-admin');
const { S3Client } = require("@aws-sdk/client-s3");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

const fs = require("fs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});


const validateUpload = (req, res) => {
  const file = req.licensefile;
  // Array of allowed files
  const array_of_allowed_files = ['png', 'jpeg', 'jpg'];
  const array_of_allowed_file_types = ['image/png', 'image/jpeg', 'image/jpg'];
  // Allowed file size in mb
  const allowed_file_size = process.env.ALLOWFILESIZE;
  // Get the extension of the uploaded file
  const file_extension = file.originalname.slice(
    ((file.originalname.lastIndexOf('.') - 1) >>> 0) + 2
  );

  // Check if the uploaded file is allowed
  if (!array_of_allowed_files.includes(file_extension) || !array_of_allowed_file_types.includes(file.memetype)) {
    throw Error('Invalid file');
  }

  if ((file.size / (1024 * 1024)) > allowed_file_size) {
    throw Error('File too large');
  }
}


const errorMessages = {
  LIMIT_PART_COUNT: 'Too many parts',
  LIMIT_FILE_SIZE: 'File too large',
  LIMIT_FILE_COUNT: 'Too many files',
  LIMIT_FIELD_KEY: 'Field name too long',
  LIMIT_FIELD_VALUE: 'Field value too long',
  LIMIT_FIELD_COUNT: 'Too many fields',
  LIMIT_UNEXPECTED_FILE: 'File limit Exceeded',
  MISSING_FIELD_NAME: 'Field name missing'
}

function MulterError(code, field) {
  Error.captureStackTrace(this, this.constructor)
  this.name = this.constructor.name
  this.message = errorMessages[code]
  this.code = code
  if (field) this.field = field
}

util.inherits(MulterError, Error)


const AWSFileUploadCLOSED = async (filePath, destination) => {
  try {
    const bucketName = 'hitchpaykyc';
    if (filePath != '') {
      console.log('filePath', filePath)
      console.log('fileName', destination)

        // AWS S3 Configuration
        const s3 = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });


        const fileContent = fs.readFileSync(filePath);

        const params = {
            Bucket: bucketName,
            Key: destination, // File name in S3
            Body: fileContent,
            ContentType: "application/pdf", // Change based on file type
        };
    
        try {
            const command = new PutObjectCommand(params);
            await s3.send(command);
            console.log(`File uploaded successfully: https://${bucketName}.s3.amazonaws.com/${destination}`);
            return `https://${bucketName}.s3.amazonaws.com/${destination}`
        } catch (error) {
            console.error("Error uploading file:", error);
        }


    }
  } catch (error) {
    console.log('firebase uplod catch ERROR: ' + error);
  }
}

const AWSFileUpload = async (fileBuffer, destination) => { // Changed filePath to fileBuffer
  try {
    const bucketName = 'hitchpaykyc'; // Make sure this is correct
    if (fileBuffer) { // Check if buffer exists
      console.log('Uploading to S3:', destination);

      const s3 = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const params = {
        Bucket: bucketName,
        Key: destination,
        Body: fileBuffer, // Use the buffer directly
        ContentType: "application/pdf", // Or determine dynamically if needed
        // ACL: 'public-read' // Optional: if you want the file to be publicly accessible
      };

      const command = new PutObjectCommand(params);
      const doupload = await s3.send(command);
      const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${destination}`; // Construct URL correctly
      // console.log(`File uploaded successfully: ${fileUrl}`);

      if(doupload['$metadata']['httpStatusCode'] == 200){
        return [true, fileUrl];
      }else{
        return [false, ''];
      }

    } else {
        console.error("AWSFileUpload: No file buffer provided.");
        return [false, ''];
    }
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    return [false, ''];
  }
};


module.exports = {
  cloudinary, validateUpload, MulterError, AWSFileUpload
}
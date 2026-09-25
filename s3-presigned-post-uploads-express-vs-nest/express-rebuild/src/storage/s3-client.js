import {S3Client} from "@aws-sdk/client-s3";

export function createS3Client(config) {
    return new S3Client({
        region: config.s3.region,
        endpoint: config.s3.endpoint,
        forcePathStyle: config.s3.forcePathStyle,
        credentials: {
            accessKeyId: config.s3.accessKeyId,
            secretAccessKey: config.s3.secretAccessKey,
        },
    });
}
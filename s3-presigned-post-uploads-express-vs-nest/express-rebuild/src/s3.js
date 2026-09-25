import {createPresignedPost} from "@aws-sdk/s3-presigned-post";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export function createS3Storage(config) {
    const client = new S3Client({
        region: config.s3.region,
        endpoint: config.s3.endpoint,
        forcePathStyle: config.s3.forcePathStyle,
        credentials: {
            accessKeyId: config.s3.accessKeyId,
            secretAccessKey: config.s3.secretAccessKey,
        },
    });

    return {
        signUpload: async ({ key }) => {
            return createPresignedPost(client, {
                Bucket: config.s3.bucket,
                Key: key,
                Conditions: [
                    ["content-length-range", 1, config.maxFileSizeBytes],
                    ["eq", "$Content-Type", config.allowedContentType],
                ],
                Fields: {
                    "Content_Type": config.allowedContentType,
                },
                Expires: config.uploadUrlTtlSeconds,
            });
        },
        headObject: async ({ key }) => {
            return client.send(
                new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key })
            )
        },
        getDownloadUrl: async ({ key, filename }) => {
            return getSignedUrl(client, new GetObjectCommand({
                    Bucket: config.s3.bucket,
                    Key: key,
                    ResponseContentDisposition: `attachment; filename="${filename}"`,
                }),
                { expiresIn: config.downloadUrlTtlSeconds })
        },
        deleteObject: async ({ key }) => {
            await client.send(new DeleteObjectCommand({
                Bucket: config.s3.bucket,
                Key: key
            }))
        }
    }
}
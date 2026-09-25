import {createPresignedPost} from "@aws-sdk/s3-presigned-post";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {DeleteObjectCommand, GetObjectCommand, HeadObjectCommand} from "@aws-sdk/client-s3";
import {createS3Client} from "./s3-client.js";

export function createS3Storage(config) {
  const client = createS3Client(config)

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
package s3

import (
	"context"
	"errors"
	"fmt"
	"log"
	"io/ioutil"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/ec2/imds"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/buildkite/elastic-ci-stack-s3-secrets-hooks/s3secrets-helper/v2/sentinel"
)

type Client struct {
	s3 *s3.Client
	bucket string
}

func getRegion(ctx context.Context) (string, error) {
	if region := os.Getenv("AWS_DEFAULT_REGION"); len(region) > 0 {
		return region, nil
	}

	imdsClient := imds.New(imds.Options{})
	if result, err := imdsClient.GetRegion(ctx, nil); err == nil {
		if len(result.Region) > 0 {
			return result.Region, nil
		}
	}

	return "", errors.New("Unknown current region")
}

func New(log *log.Logger, bucket string) (*Client, error) {
	ctx := context.Background()

	// Using the current region (or a guess) find where the bucket lives

	region, err := getRegion(ctx)
	if err != nil {
		// Ignore error and fallback to us-east-1 for bucket lookup
		region = "us-east-1"
	}

	config, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
	)
	if err != nil {
		return nil, fmt.Errorf("Could not load the AWS SDK config (%v)", err)
	}

	log.Printf("Discovered current region as %q\n", config.Region)

	bucketRegion, err := manager.GetBucketRegion(ctx, s3.NewFromConfig(config), bucket)
	if err != nil {
		return nil, fmt.Errorf("Could not discover the region for bucket %q: (%v)", bucket, err)
	}

	log.Printf("Discovered bucket region as %q\n", bucketRegion)

	config.Region = bucketRegion

	return &Client{
		s3: s3.NewFromConfig(config),
		bucket: bucket,
	}, nil
}

func (c *Client) Bucket() (string) {
	return c.bucket
}

// Get downloads an object from S3.
// Intended for small files; object is fully read into memory.
// sentinel.ErrNotFound and sentinel.ErrForbidden are returned for those cases.
// Other errors are returned verbatim.
func (c *Client) Get(key string) ([]byte, error) {
	out, err := c.s3.GetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: &c.bucket,
		Key:    &key,
	})
	if err != nil {
		var noSuchKey *types.NoSuchKey
		if errors.As(err, &noSuchKey) {
			return nil, sentinel.ErrNotFound
		}

		// Possible values can be found at https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			code := apiErr.ErrorCode()
			if code == "AccessDenied" {
				return nil, sentinel.ErrForbidden
			}
		}

		return nil, fmt.Errorf("Could not GetObject (%s) in bucket (%s). Ensure your IAM Identity has s3:GetObject permission for this key and bucket. (%v)", key, c.bucket, err)
	}
	defer out.Body.Close()
	// we probably should return io.Reader or io.ReadCloser rather than []byte,
	// maybe somebody should refactor that (and all the tests etc) one day.
	return ioutil.ReadAll(out.Body)
}

// BucketExists returns whether the bucket exists.
// 200 OK returns true without error.
// 404 Not Found and 403 Forbidden return false without error.
// Other errors result in false with an error.
func (c *Client) BucketExists() (bool, error) {
	if _, err := c.s3.HeadBucket(context.TODO(), &s3.HeadBucketInput{Bucket: &c.bucket}); err != nil {
		return false, fmt.Errorf("Could not HeadBucket (%s). Ensure your IAM Identity has s3:ListBucket permission for this bucket. (%v)", c.bucket, err)
	}
	return true, nil
}

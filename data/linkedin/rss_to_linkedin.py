#!/usr/bin/env python3
import time
import argparse
import os

def main():
    parser = argparse.ArgumentParser(description='Mock RSS to LinkedIn importer')
    parser.add_argument('--max-posts', type=int, default=5)
    parser.add_argument('--job-id', type=str, default='mock_job')
    args = parser.parse_args()

    print(f"Starting mock RSS import job: {args.job_id}")
    print(f"Max posts: {args.max_posts}")
    
    time.sleep(2)
    print("Fetching RSS feeds...")
    time.sleep(2)
    
    for i in range(args.max_posts):
        print(f"Processing: Mock Post {i+1}")
        time.sleep(1)
        print(f"Saved to calendar: Mock Post {i+1}")
    
    print("RSS import completed successfully")

if __name__ == "__main__":
    main()

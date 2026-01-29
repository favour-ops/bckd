#!/bin/bash

# right directory
cd /home/ubuntu/hitchpaybckd

# Get the env file here
cp /home/ubuntu/env/.env .
cp /home/ubuntu/env/serviceAccountKey.json config/

# install packages
sudo npm install
sudo systemctl restart pm2-root
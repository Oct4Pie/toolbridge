#!/bin/bash

curl -N -X POST http://localhost:3100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma3:latest",
    "messages": [
      {"role": "user", "content": "Create a file named test.txt"}
    ],
    "tools": [
      {"type": "function", "function": {"name": "create_file", "parameters": {}}}
    ],
    "stream": true
  }' 2>&1

docker build -t funding-dashboard .
docker run -d   -p 3000:3000   --name funding-dashboard   funding-dashboard:latest
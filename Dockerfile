FROM alpine:3.16
FROM node:16.13-alpine

# create and set app directory
RUN mkdir -p /root/pactAgent/
WORKDIR /root/pactAgent/

# install app dependencies
# this is done before the following COPY command to take advantage of layer caching
COPY package.json .
RUN npm install --legacy-peer-deps

# copy app source to destination container
COPY . .

# expose container port
EXPOSE 3000

CMD npm start
# Use the official Node.js image as the base image
FROM node:16 as build-stage

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Vue app
RUN npm run build

# Use the official Nginx image to serve the app
FROM nginx:stable-alpine as production-stage

# Copy the built app to the Nginx HTML directory
COPY --from=build-stage /app/dist /usr/share/nginx/html/llamadle

# Copy a custom Nginx configuration file
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
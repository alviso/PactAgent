const config = require("../config.js");
const grpc = require('@grpc/grpc-js')
const internalService = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_grpc_pb')
const internalMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/internal_pb')
const gatewayService = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_grpc_pb')
const gatewayMessages = require('@crankk.io/chirpstack-api-fork/as/external/api/gateway_pb')
const Pact = require("pact-lang-api");

class chirpstackService {

    constructor() {
        // Create the client for the 'internal' service
        const internalServiceClient = new internalService.InternalServiceClient(
            config.chirpstack.apiUrl,
            grpc.credentials.createInsecure()
        );

// Create and build the login request message
        const loginRequest = new internalMessages.LoginRequest();

        loginRequest.setEmail(config.chirpstack.email);
        loginRequest.setPassword(config.chirpstack.password);

// Send the login request
        internalServiceClient.login(loginRequest, (error, response) => {
            // Build a gRPC metadata object, setting the authorization key to the JWT we
            // got back from logging in.
            const metadata = new grpc.Metadata();
            metadata.set('authorization', response.getJwt());

            // This metadata can now be passed for requests to APIs that require authorization
            // e.g.
            // deviceServiceClient.create(createDeviceRequest, metadata, callback);
            const gatewayServiceClient = new gatewayService.GatewayServiceClient(
                config.chirpstack.apiUrl,
                grpc.credentials.createInsecure()
            )

            const streamFrameLogsRequest = new gatewayMessages.StreamGatewayFrameLogsRequest()
            streamFrameLogsRequest.setGatewayId(config.chirpstack.gatewayId)

            const clientReadableStream = gatewayServiceClient.streamFrameLogs(streamFrameLogsRequest, metadata)

            clientReadableStream.on('data', function(response){
                const obj = response.toObject()
                const payloadJson = obj.uplinkFrame?.phyPayloadJson
                const payload = JSON.parse(payloadJson)
                if (payload?.mhdr?.mType !== 'Proprietary') return
                console.log(payload, obj.downlinkFrame.gatewayId)
            });
            clientReadableStream.on('end', function(response){ //status, error, close
                console.log('Disconnected!!!')
            });

            setInterval(async ()=>{
                const sendPingRequest = new gatewayMessages.SendPingRequest()

                sendPingRequest.setGatewayId(config.chirpstack.gatewayId)

                gatewayServiceClient.sendPing(sendPingRequest, metadata, function (err, res) {
                    try {
                        const string = new TextDecoder().decode(res.getMic());
                        console.log(string)
                    } catch (e) {
                        console.log(e)
                    }
                })

            }, 5 * 60 * 1000);

        })

    }


}


module.exports = chirpstackService

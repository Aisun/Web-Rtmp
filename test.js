var RTMP = require('./node-rtmpapi');
var SimpleWebsocket = require('simple-websocket');
var Buffer = require('buffer').Buffer;

const H264_SEP = new Buffer([0,0,0,1]);

var vidCont = document.getElementById("vidCont");
var player = new Player({
 useWorker: false,
 webgl: true
});
player.canvas.style['height'] = '100%';
 vidCont.appendChild(player.canvas);

var encodeLookup = '0123456789abcdef'.split('');
var decodeLookup = [];
var i = 0;
while (i < 10) decodeLookup[0x30 + i] = i++;
while (i < 16) decodeLookup[0x61 - 10 + i] = i++;

function dumpArray(array)
{
	var length = array.length;
	var string = '';
	var c, i = 0;
	while (i < length)
	{
		c = array[i++];
		string += encodeLookup[(c & 0xF0) >> 4] + encodeLookup[c & 0xF];
		string += ' ';
	}
	console.log(string);
}

var url = "ws://127.0.0.1:1999";

var sock = new SimpleWebsocket(url);
sock.setMaxListeners(100);

sock.on('connect', function()
{
    var transId = 0;
	var stream = new RTMP.rtmpSession(sock, true, function(me)
	{
		console.log("rtmpSession...cb...");
		var invokeChannel = new RTMP.rtmpChunk.RtmpChunkMsgClass({streamId:5}, {sock: sock, Q: me.Q, debug: false});
		invokeChannel.invokedMethods = {}; //用来保存invoke的次数，以便收到消息的时候确认对应结果

		var videoChannel = new RTMP.rtmpChunk.RtmpChunkMsgClass({streamId:8}, {sock: sock, Q: me.Q, debug: false});

        var channel2 = new RTMP.rtmpChunk.RtmpChunkMsgClass({streamId:2}, {sock: sock, Q: me.Q, debug: false});

		var msger = me.msg;
		me.Q.Q(0,function()
		{
			console.log("sending connect");
			//var chunk = new RTMP.rtmpChunk.RtmpChunkMsgClass({streamId:3}, {sock: sock, Q: me.Q, debug: true});
			//todo: 先确定可行，再重构
			invokeChannel.sendAmf0EncCmdMsg({
				cmd: 'connect', 
				transId:++transId,
				cmdObj:
				{
					app:"live",
					tcUrl: "rtmp://video.7uan7uan.com/live",
					fpad: false,
					capabilities: 15.0,
					audioCodecs: 3191,
					videoCodecs: 252,
					videoFunction: 1.0
				}
			});
			invokeChannel.invokedMethods[transId] = 'connect';
		});

		me.Q.Q(0, function()
		{
			console.log("Begin LOOP");
			msger.loop(handleMessage);
		});

        function handleMessage(chunkMsg)
        {
            var chunk = chunkMsg.chunk;
            var msg = chunk.msg;

            console.log("GOT MESSAGE: " + chunk.msgTypeText);
            console.log("===========>\n" + JSON.stringify(msg));

            if(chunk.msgTypeText == "amf0cmd")
            {
                if(msg.cmd == "_result")
                {
	                var lastInvoke = invokeChannel.invokedMethods[msg.transId];
	                if(lastInvoke)
	                {
		                console.log("<--Got Invoke Result for: " + lastInvoke);
		                delete invokeChannel.invokedMethods[msg.transId];
	                }

                    if(lastInvoke == "connect") //确认是connect的结果
                    {
                        console.log("sending createStream");
                        invokeChannel.sendAmf0EncCmdMsg({
                            cmd: 'createStream',
                            transId: ++transId,
                            cmdObj: null
                        });
                        invokeChannel.invokedMethods[transId] = 'createStream';
                    }
                    else if(lastInvoke == "createStream") //确认是createStream的结果
                    {
	                    videoChannel.chunk.msgStreamId = msg.info;
                        //send play ??
                        videoChannel.sendAmf0EncCmdMsg({
                            cmd: 'play',
                            transId: ++transId,
                            cmdObj:null,
                            streamName:'B011',
	                        start:-2

                        },0);
	                    invokeChannel.invokedMethods[transId] = "play";
                    }
                }
                else if(msg.cmd == 'onBWDone')
                {
                    console.log("onBWDone");
                    //send checkBW
                    invokeChannel.sendAmf0EncCmdMsg({
                        cmd: '_checkbw',
                        transId: ++transId,
                        cmdObj:null
                    },0);
	                invokeChannel.invokedMethods[transId] = "_checkbw";
                }
            }

            if(chunk.msgTypeText == "video")
            {
                var chunkData = chunk.data;
                if (chunkData.length > 4)
                {
                    //dumpArray(data);
                    //console.log("\n");

                    if (chunkData[1] === 1)
                    {
                        chunkData = Buffer.concat([H264_SEP, chunkData.slice(9)]);
                    }
                    else if (chunkData[1] === 0)
                    {
                        var spsSize = (chunkData[11] << 8) | chunkData[12];
                        var spsEnd = 13 + spsSize;
                        chunkData = Buffer.concat([H264_SEP, chunkData.slice(13, spsEnd), H264_SEP, chunkData.slice(spsEnd + 3)]);
                    }
                    player.decode(chunkData);
                }

	            /*var data = chunk.data;

	            var vidHdr = new Buffer(11);
	            vidHdr.writeUInt8(0x09,0);//type video

	            vidHdr.writeUInt16BE(chunk.data.length >> 8, 1); //packet len
	            vidHdr.writeUInt8(chunk.data.length & 0xFF, 3);

	            vidHdr.writeInt32BE(0, 4); //ts
	            vidHdr.writeUInt16BE(0 >> 8, 8); //stream id
	            vidHdr.writeUInt8(0 & 0xFF, 10);

	            var prevSize = new Buffer(4);
	            prevSize.writeUInt32BE(data.length + 11);

	            //console.log("RAW DATA: ");
	            //console.log(JSON.stringify(data));
	            flvParser.write(Buffer.concat([vidHdr, data, prevSize]));
	            //*/
            }

	        if(chunk.msgTypeText == "amf0meta" && msg.cmd == 'onMetaData')
	        {
		        console.log("onmetadata");

		        /*var metaHdr = new Buffer(11);
		        metaHdr.writeUInt8(0x12,0);//type metadata

		        metaHdr.writeUInt16BE(chunkData.length >> 8, 1); //packet len
		        metaHdr.writeUInt8(chunkData.length & 0xFF, 3);

		        metaHdr.writeInt32BE(0, 4); //ts
		        metaHdr.writeUInt16BE(0 >> 8, 8); //stream id
		        metaHdr.writeUInt8(0 & 0xFF, 10);

		        var prevSize2 = new Buffer(4);
		        prevSize2.writeUInt32BE(chunkData.length + 11);

		        flvParser.write(Buffer.concat([FLV_HEADER,metaHdr, chunkData, prevSize2]));

		        //var prevSize = new Buffer(4);
			    //prevSize.writeUInt32BE(chunkData.length + 11);
			    //flvParser.write(prevSize);*/
	        }

            me.Q.Q(0,function(){
                msger.loop(handleMessage);
            });
        }
	});
});

var testOptions = require( './env-options.js' )()
var test = require( 'tape' )
var grunt = require( 'grunt' )
var webhookTasks = require( '../Gruntfile.js' )

webhookTasks( grunt )

var commandDelegator = require( '../libs/commandDelegator.js' )
var JobQueue = require( '../libs/jobQueue.js' )

var commandor = commandDelegator.start( grunt.config, console.log )
var jobQueue = JobQueue.init( grunt.config )

// accepts command data at a particular node in firebase
var options = [ {
  tube: 'build',
  data: {
    userid: 'test-user',
    sitename: 'commencement,1risd,1systems',
    branch: 'master',
    buildtime: '1',
    id: 'unique-id',
    contentType: 'content-type',
    itemKey: 'item-key',
  },
  expectedData: {
    userid: 'test-user',
    sitename: 'commencement,1risd,1systems',
    branch: 'master',
    buildtime: '1',
    id: 'unique-id',
    contentType: 'content-type',
    itemKey: 'item-key',
    siteBucket: 'commencement.risd.edu'
  },
  handler: function ( handlerPayload, handlerIdentifier, handlerData, handlerClient, handlerCallback ) {
    this.t.deepEqual( handlerData, this.expectedData, 'The payload is consistent for tube: ' + this.tube )
    handlerCallback()
  }
} ]


test( 'command-build', function ( t ) {
  t.plan( options.length )

  options.forEach( function ( opts ) {
    jobQueue.reserveJob( opts.tube, opts.lock, opts.handler.bind( Object.assign( { t: t }, opts ) ) )
  } )

  commandor.on( 'ready', function ( commandHandlers ) {
    options.forEach( function ( opts ) {
      commandHandlers.queueFirebase( { tube: opts.tube, data: opts.data } )
    } )
  } )
} )

test.onFinish( process.exit )

var testOptions = require( './env-options.js' )()
var fs = require( 'fs' )
var mime = require( 'mime' )
var path = require( 'path' )
var test = require( 'tape' )
var grunt = require( 'grunt' )
var request = require( 'request' )
var webhookTasks = require( '../Gruntfile.js' )

webhookTasks( grunt )

var Server = require( '../libs/server.js' )
var server = Server.start( grunt.config, console.log )
var serverUrl = `http://localhost:${ server.port }`

function siteToken () {
  return {
    site: 'commencement,1risd,1systems',
    token: 'd1b96975-edd0-4f8c-af62-cf05d134f28a',
  }
}

// RequestOptions : {}
// ResponseTest : expectedValue => testInjector => makeAssertions
// ResponseTest.testCount : Int
// tests : [ req : RequestOptions, res : [ResponseTest] ]
var tests = [
  {
    name: 'GET /',
    req: {
      method: 'GET',
      uri: serverUrlForPath( '/' ),
    },
    res: [ statusCode( 200 ) ],
  },
  {
    name: 'GET /backup-snapshot/',
    req: {
      method: 'GET',
      uri: serverUrlForPath( '/backup-snapshot/' ),
      qs: Object.assign( {
        timestamp: '1539893985031',
      }, siteToken() ),
    },
    res: [ statusCode( 200 ), jsonBody( siteDataShape ), ],
  },
  {
    name: 'GET /backup-snapshot/ fail',
    req: {
      method: 'GET',
      uri: serverUrlForPath( '/backup-snapshot/' ),
      qs: {},
    },
    res: [ statusCode( 500 ) ],
  },
  {
    name: 'POST /upload-url/',
    req: {
      method: 'POST',
      uri: serverUrlForPath( '/upload-url/' ),
      json: true,
      body: Object.assign( {
        resize_url: true,
        url: 'https://lh3.googleusercontent.com/G6Tkw7hXhmR34zpkXA3nBHZ05tgAb2OewVO5NOrv5LUovd-UIqtaZ3rOoNemzXosxFt4HrQXshJ3UIbDuwQOf2sIjQJcuuGeSalc4QG1E1s=s760',
      }, siteToken() ),
    },
    res: [ statusCode( 200 ), jsonBody( uploadedFileShape ) ],
  },
  {
    name: 'POST /upload-file/', 
    req: {
      method: 'POST',
      uri: serverUrlForPath( '/upload-file/' ),
      headers: {
          'Content-Type': 'multipart/form-data',
      },
      multipart: [ {
        'Content-Disposition': 'form-data; name="payload"; filename="img.png"',
        'Content-Type': mime.lookup( 'img.png' ),
        body: fs.readFileSync( path.join( __dirname, 'files', 'img.png' ) ),
      }, {
        'Content-Disposition': 'form-data; name="site"',
        body: siteToken().site,
      }, {
        'Content-Disposition': 'form-data; name="token"',
        body: siteToken().token,
      }, {
        'Content-Disposition': 'form-data; name="resize_url"',
        body: "true"
      } ],
    },
    res: [ statusCode( 200 ), jsonBody( uploadedFileShape ) ],
  },
  {
    name: 'POST /search/',
    req: {
      method: 'POST',
      uri: serverUrlForPath( '/search/' ),
      json: true,
      body: Object.assign( {
        query: 'home',
      }, siteToken() ),
    },
    res: [ statusCode( 200 ), jsonBody( searchResultsShape ) ],
  },
  {
    name: 'POST /search/index/',
    req: {
      method: 'POST',
      uri: serverUrlForPath( '/search/index/' ),
      json: true,
      body: Object.assign( {}, siteToken(), searchDocument() ),
    },
    res: [ statusCode( 200 ), jsonBody( searchIndexShape ) ],
  },
  {
    name: 'POST /search/delete/',
    req: {
      method: 'POST',
      uri: serverUrlForPath( '/search/delete/' ),
      json: true,
      body: Object.assign( {}, siteToken(), searchDocument() ),
    },
    res: [ statusCode( 200 ), jsonBody( searchIndexShape ) ],
  },
  // method : POST, url : /search/delete/type/, json : true, body : { site, token, typeName }
  // method : POST, url : /search/delete/index/, json : true, body : { site, token }
  // {
  //   name: 'POST /upload/',
  //   req: {
  //     method: 'POST',
  //     uri: serverUrlForPath( '/upload/' ),
  //     json: true,
  //     body: Object.assign( {
  //       branch: 'feature/test',
  //       payload: 'file.zip'
  //     }, siteToken() ),
  //   }
  //   res: [ statusCode( 200 ), jsonBody( uploadedFileShape ) ],
  // },
]

tests.forEach( function makeTest ( testSpec ) {
  test( testSpec.name, function ( t ) {
    var testCount = testSpec.res.reduce( resCount, 0 )
    t.plan( testCount )
    runTest( t )( testSpec )
  } )  
} )

test.onFinish( process.exit )


function statusCode ( expected ) {
  function injectTest ( t ) {
    return function testResponse ( testName, error, response, body ) {
      t.assert( expected === response.statusCode, `${ testName}: Status code is ${ response.statusCode }, expected ${ expected }.` )
    }
  }
  injectTest.testCount = 1;
  return injectTest;
}

function jsonBody ( expectedShape ) {
  function injectTest ( t ) {
    return function testResponse ( testName, error, response, body ) {
      var parseError;
      try {
        var payload = typeof body === 'string' ? JSON.parse( body ) : body;  
        t.assert( typeof payload === 'object', `${ testName }: Body is JSON` )
      }
      catch ( jsonParseError ) {
        parseError = jsonParseError
        t.fail( `${ testName }: Body is not JSON` )
      }
      
      if ( ! error && ! parseError && expectedShape ) {
        t.assert( expectedShape( payload ), `${ testName }: Body conforms to shape.` )
      }
      else if ( expectedShape ) {
        t.fail( `${ testName }: Body not an object, could not test shape.` )
      }
    }
  }
  injectTest.testCount = expectedShape ? 2 : 1 ;
  return injectTest;
}

function siteDataShape ( obj ) {
  return obj.hasOwnProperty( 'contentType' ) &&
         obj.hasOwnProperty( 'data' ) &&
         obj.hasOwnProperty( 'settings' )
}

function uploadedFileShape ( obj ) {
  return obj.hasOwnProperty( 'message' ) &&
         obj.hasOwnProperty( 'url' ) &&
         obj.hasOwnProperty( 'size' ) &&
         obj.hasOwnProperty( 'mimeType' )
}

function searchResultsShape ( obj ) {
  return obj.hasOwnProperty( 'hits' )
}

function searchIndexShape ( obj ) {
  return obj.hasOwnProperty( 'message' )
}

function searchDocument () {
  return {
    data: JSON.stringify( { name: 'test-title' } ),
    id: 'one-off-page',
    typeName: 'pages',
    oneOff: true,
  }
}


// helpers

function countTests ( count, testObject ) {
  return count + testObject.res.reduce( resCount, 0 )
}

function resCount ( resCount, resFn ) {
  return resCount + resFn.testCount;
}

function runTest ( t ) {
  return makeRequest;

  function makeRequest( options ) {
    request( options.req, handleResponse )

    function handleResponse ( error, response, body ) {
      options.res.map( testInjector ).map( runAssertions )

      function runAssertions ( makeAssertions ) {
        makeAssertions( options.name, error, response, body )
      }
    }
  }

  function testInjector ( resExpectedValue ) {
    return resExpectedValue( t )
  }
}

function serverUrlForPath ( path ) {
  return `${ serverUrl }${ path }`
}

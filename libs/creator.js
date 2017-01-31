'use strict';

/**
* The create worker is the worker that handles initializing a site for the first time when someone runs
* wh create. It creates the initial bucket used to store the sites eventual html, and handles correctly
* setting the permissions on the bucket. It also generates the access key that is used to read/write from
* the bucket in firebase.
*/

// Requires
var firebase = require('firebase');
var colors = require('colors');
var _ = require('lodash');
var uuid = require('node-uuid');
var JobQueue = require('./jobQueue.js');
var request = require('request');
var miss = require('mississippi');

var cloudStorage = require('./cloudStorage.js');

var escapeUserId = function(userid) {
  return userid.replace(/\./g, ',1');
};

var unescapeSite = function(site) {
  return site.replace(/,1/g, '.');
}

/**
 * @param  {Object}   config     Configuration options from .firebase.conf
 * @param  {Object}   logger     Object to use for logging, defaults to no-ops (deprecated)
 */
module.exports.start = function (config, logger) {
  
  cloudStorage.setProjectName(config.get('googleProjectId'));
  cloudStorage.setServiceAccount(config.get('googleServiceAccount'));

  var jobQueue = JobQueue.init(config);
  var self = this;
  var firebaseUrl = config.get('firebase') || '';

  this.root = new firebase('https://' + firebaseUrl +  '.firebaseio.com');

  self.root.auth(config.get('firebaseSecret'), function(err) {
    if(err) {
      console.log(err.red);
      process.exit(1);
    }

    console.log('Waiting for commands'.red);

    // Wait for create commands from firebase
    jobQueue.reserveJob('create', 'create', function(payload, identifier, data, client, callback) {
      var userid = data.userid;
      var site = data.sitename;

      console.log('Processing Command For '.green + site.red);
      self.root.child('management/sites/' + site).once('value', function(siteData) {
        var siteValues = siteData.val();

        // IF site already has a key, we alraedy created it, duplicate job
        if(siteValues.key)
        {
          console.log('Site already has key');
          callback();
        }
        // Else if the site owner is requesting, we need to make it
        else if(_(siteValues.owners).has(escapeUserId(userid)))
        {
          self.root.child('management/sites/' + site + '/error/').set(false, function(err) {
            // We setup the site, add the user as an owner (if not one) and finish up
            setupSite(site, siteValues, siteData, siteData.ref(), userid, function(err) {
              if(err) {
                self.root.child('management/sites/' + site + '/error/').set(true, function(err) {
                  console.log('Error Creating Site For '.green + site.red);
                  callback();
                });
              } else {
                self.root.child('management/users/' + escapeUserId(userid) + '/sites/owners/' + site).set(true, function(err) {
                  console.log('Done Creating Site For '.green + site.red);
                  callback();
                });
              }
            });
          });
        } else {
          // Someone is trying to do something they shouldn't
          console.log('Site does not exist or no permissions');
          callback();
        }
      }, function(err) {
        callback();
      });
    });
  });


  /*
  * Sets up the necessary components of a webhook site
  *
  * @param siteValue The values of the site in firebase
  * @param siteData  The actual data of the site in firebase
  * @param siteRef   Firebase reference to the site node
  * @param userid    The userid creatign the site
  * @param callback  Called when done
  */
  function setupSite(site, siteValue, siteData, siteRef, userid, callback) {

    var key = uuid.v4();

    var siteBucket = unescapeSite(site);

    console.log('setting up site')
    console.log(siteBucket)
    console.log(key)

    var setupSiteWith = function (input) {
      var readIndex = 0;
      var emitter = miss.through.obj();

      process.nextTick(function () {
        if ( !Array.isArray( input ) )
          return emitter.push( null )

        if ( input[ input.length - 1] !== null )
          input = input.concat( [ null ] )
        
        input.forEach( function ( item ) {
          process.nextTick( function () {
            emitter.push( item )
          } )
        } )
      })

      return emitter;
    }

    // Does the bucket exist? Useful for setting up buckets
    // against domains that are verified, but cause issues
    // creating through this interface
    var getBucket = function () {
      return miss.through.obj(function (row, enc, next) {
        console.log( 'site-setup:get-bucket:', row.siteBucket )
        cloudStorage.buckets.get(row.siteBucket, function (err, body) {
          if ( err ) {
            console.log( 'site-setup:get-bucket:error' )
            return next( null, row )
          }

          row.bucketExists = true;
          return next( null, row );
        })
      })
    }

    var createBucket = function () {
      return miss.through.obj(function (row, enc, next) {
        if ( row.bucketExists === false ) {
          console.log( 'site-setup:create-bucket:', row.siteBucket )
          cloudStorage.buckets.create(row.siteBucket, function (err, body) {
            if ( err ) {
              console.log( 'site-setup:create-bucket:error' )
              return next( err, null )
            }

            row.bucketExists = true;
            next( null, row );
          })
        }
        else {
          next( null, row )
        }
      });
    }

    var updateAcls = function () {
      return miss.through.obj(function (row, enc, next) {
        if ( row.bucketExists === false ) return next( null, row)
        
        console.log( 'site-setup:update-acls:', row.siteBucket )
        cloudStorage.buckets.updateAcls( row.siteBucket, function (err, body) {
          if ( err )
            return next( err, null)

          next( null, row )
        } )

      });
    }

    var updateIndex = function () {
      return miss.through.obj(function (row, enc, next) {
        if ( row.bucketExists === false ) return next( null, row )

        console.log( 'site-setup:update-index:', row.siteBucket )
        cloudStorage.buckets.updateIndex(
          row.siteBucket,
          'index.html', '404.html',
          function ( err, body ) {
            if ( err ) return next( err, null )

            next( null, row )
          } )
      });
    }

    var generateKey = function () {
      return miss.through.obj(function (row, enc, next) {
        if ( row.bucketExists === true && row.siteKey.length > 0 ) {
          console.log( 'site-setup:generate-key:', row.siteBucket )

          siteRef.child('key').set(row.siteKey, function(err) {
            console.log('site-setup:generate-key:setting-billing:')
            console.log(err)

            // Set some billing info, not used by self-hosting, but required to run
            siteRef.root().child('billing/sites/' + row.siteName).set({
              'plan-id': 'mainplan',
              'email': userid,
              'status': 'paid',
              'active': true,
              'endTrial' : Date.now()
            }, function(err) {
              console.log( 'site-setup:generate-key:' )
              next( null, row );
            });
          });
        }
        else {
          next( null, row );
        }
      });
    }

    var sink = function () {
      return miss.through.obj( function ( row, enc, next ) {
        next();
      } )
    }

    miss.pipe(
        setupSiteWith([{
          siteName:     site,
          siteBucket:   siteBucket,
          bucketExists: false,
          siteKey:      key
        }]),
        getBucket(),
        createBucket(),
        updateAcls(),
        updateIndex(),
        generateKey(),
        sink(),
        function onEnd ( error ) {
          if ( error ) return callback( error )
          else return callback();
        }
      )

    // Create a bucket in cloud storage
    // cloudStorage.buckets.create(siteBucket, function(err, body) {

    //   console.log('done creating bucket')

    //   if(err) {
    //     console.log(err)
    //     try {
    //       console.log( err.message )
    //       console.log( JSON.stringify(err) )
    //     } catch (e) {
    //       console.log('could not log')
    //     }
    //     callback(err);
    //     return;
    //   }

    //   console.log('update acls')

    //   // Adjust the ACLS
    //   cloudStorage.buckets.updateAcls(siteBucket, function(err, body) {

    //     console.log('done updating acls')

    //     if(err) {
    //       console.log(err)
    //       callback(err);
    //       return;
    //     }

    //     console.log('setting key')

    //     // Generate and set the access key
    //     siteRef.child('key').set(key, function(err) {
    //       console.log('setting billing')
    //       console.log(err)
    //       // Set some billing info, not used by self-hosting, but required to run
    //       siteRef.root().child('billing/sites/' + siteData.name()).set({
    //         'plan-id': 'mainplan',
    //         'email': userid,
    //         'status': 'paid',
    //         'active': true,
    //         'endTrial' : Date.now()
    //       }, function(err) {
    //         console.log('done')
    //         console.log(err)
    //         callback();
    //       });
    //     });
    //   });
    // });

  }

};

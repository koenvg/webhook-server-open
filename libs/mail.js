

var Firebase = require('./firebase/index.js');
var _ = require('lodash');
var JobQueue = require('./jobQueue.js');
var fs = require('fs');
const sgMail = require('@sendgrid/mail');



/**
* @param  {Object}   config     Configuration options from .firebase.conf
* @param  {Object}   logger     Object to use for logging, defaults to no-ops (deprecated)
*/
module.exports.start = function (config, logger) {
  var jobQueue = JobQueue.init(config);
  sgMail.setApiKey(config.get('sendGridKey'));

  var self = this;
  var firebaseOptions = Object.assign(
    { initializationName: 'create-worker' },
    config().firebase)

  // project::firebase::initialize::done
  var firebase = Firebase(firebaseOptions)
  this.root = firebase.database()

  console.log('Waiting for mail'.red);

  // Wait for jobs
  jobQueue.reserveJob('mail', 'mail', function (payload, identifier, data, client, callback) {
    var fromEmail = data.from;
    var toEmail = data.to;
    var subject = data.subject;
    var message = data.message;

    sendMail(toEmail, fromEmail, subject, message);
    callback();
  });

  /*
   * Sends a registration-invite email to the user. This is an email that both sends the user
   * to the registration part of the webhook site.
   *
   * @param email        The email to send the invite to
   * @param fromEmail The username (email) thats being invited, should be the same as email
   * @param siteref      The site that the user is being invited to
   */
  function sendMail(toEmail, fromEmail, subject, content) {
    var datetime = new Date();
    console.log(datetime + 'Sending email');

    config.get('sendGridKey')
    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: subject,
      html: content,
    };

    sgMail
      .send(msg)
      .catch(console.error);


    //Save the mail to disk just to be sure
    fs.writeFile("/tmp/mail-backup/" + datetime + ".html", content, function (err) {
      if (err) {
        return console.log(err);
      }
      console.log("the mail was saved.");
    })
  }
};

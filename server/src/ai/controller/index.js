const helper = require('../utils/helper')
const schemes = require('../models/mongoose');
const { performance } = require('perf_hooks');
const config = require('../../../config');
const path = require('path')
const fs = require('fs')

const dataset = readHateSpeechTextFile(path.resolve('./', 'hate_speech.txt'));

function readHateSpeechTextFile(file) {
  const separator = /,/g;
  const fileContent = fs.readFileSync(file, 'utf-8');
  const matchIndexes = [];

  let match;
  while ((match = separator.exec(fileContent)) != null) {
    matchIndexes.push(match.index);
  }

  const allHateWords = [];
  let lastIndex = 0;

  for (let i = 0; i < matchIndexes.length; i++) {
    if (i === 0) {
      allHateWords.push((fileContent.substring(lastIndex, matchIndexes[i])).toLowerCase());
    }
    else {
      allHateWords.push((fileContent.substring(lastIndex + 1, matchIndexes[i])).toLowerCase());
    }
    lastIndex = matchIndexes[i];
  }
  return allHateWords;
}

let bulkContainer;
let bulkUrls = {}

module.exports.check = async (req, res) => {
  let link = await schemes.Link.findOne({ url: req.query.url })
  if (link == null) {
    //send request to start new crawling job
    return res.status(404).send();
  }
  res.status(200).json(link);
}

module.exports.analyse = async (req, res) => {
  if(Object.keys(bulkUrls).includes(req.body.url))
    return res.status(200).send({ message: 'Page was already in database', link })

  let link = await schemes.Link.findOne({ url: req.body.url })
  if (link != null)
    return res.status(200).send({ message: 'Page was already in database', link })

  const contents = await helper.get_web_content(req.body.url)
  if (contents == null)
    return res.status(500).send("Could not successfully load this web page")

  const startTime = performance.now()
  let words = []
  for(let i=0; i<dataset.length; i++){
    if(contents.toLowerCase().includes(dataset[i].toLowerCase())){
      words.push(dataset[i])
    }
  }
  if (words.length>3) {
    link = schemes.Link({
      url: req.body.url,
      is_harmful: true,
      hate_words: words,
      last_updated: new Date(),
      is_reported: false,
      times_reported: 0
    });

    if (bulkContainer) {
      bulkContainer.insert(link);
      bulkUrls[req.body.url] = link;
      if (bulkContainer.length >= 50) {
        bulkContainer.execute((error) => {
          if (error) {
            console.log('Error happened while performing the operations to the database.')
          } else {
            // We reset the bulk container, to create a new one.
            bulkContainer = null;
            bulkUrls = {}
          }
        });
      }
    } else {
      // If we don't have a bulkContainer defined, we create one and add then add the operation to it.
      bulkContainer = schemes.Link.collection.initializeUnorderedBulkOp();
      bulkContainer.insert(link);
      bulkUrls[req.body.url] = link;
    }

    const endTime = performance.now()
    res.status(201).json({ time_taken: endTime - startTime, is_harmful: true, url: req.body.url });
  } else {
    link = schemes.Link({
      url: req.body.url,
      is_harmful: false,
      hate_words: [],
      last_updated: new Date(),
      is_reported: false,
      times_reported: 0
    });

    if (bulkContainer) {
      bulkContainer.insert(link);
      bulkUrls[req.body.url] = link;
      if (bulkContainer.length >= 50) {
        bulkContainer.execute((error) => {
          if (error) {
            console.log('Error happened while performing the operations to the database.')
          } else {
            // We reset the bulk container, to create a new one.
            bulkContainer = null;
            bulkUrls = {}
          }
        });
      }
    } else {
      // If we don't have a bulkContainer defined, we create one and add then add the operation to it.
      bulkContainer = schemes.Link.collection.initializeUnorderedBulkOp();
      bulkContainer.insert(link);
      bulkUrls[req.body.url] = link;
    }
    const endTime = performance.now()
    res.status(200).json({ time_taken: endTime - startTime, is_harmful: false, url: req.body.url });
  }
};

module.exports.report = async (req, res) => {
  let link = await schemes.Link.findOne({ url: req.body.url })
  if (link != null) {
    if (!link.is_reported) {
      return res.status(200).send({ message: 'Page was already in database', link })
    }
    let times = link.times_reported + 1
    if(times > config.minTimesReportedToConsiderTrue)
      link.is_harmful = true
    if(req.body.words)
      req.body.words.map(word => {
        if (link.hate_words.indexOf(word) === -1) {
          link.hate_words.push(word)
          if (times > config.minTimesReportedToConsiderTrue)
            dataset.push(word)
        }
      })
    link = await schemes.Link.findOneAndUpdate({ url: req.body.url }, { times_reported: times, hate_words: link.hate_words }, { new: true })
    return res.status(200).send({ message: `Reported website for the ${times}th time`, link })
  } else {
    link = schemes.Link({
      url: req.body.url,
      is_harmful: true,
      hate_words: req.body.words ? req.body.words : [],
      last_updated: new Date(),
      is_reported: false,
      times_reported: 1
    })
    link.save();
    res.status(201).json(link);
  }

};

module.exports.add_expression = async (req, res) => {
  res.send("Works !")
}

module.exports.reset = async (res) => {
  await schemes.Link.deleteMany({})
  res.send("Cleared Database !")
};

module.exports.getStats = (res) => {
  // Since these functions don't return promises, we have to use callbacks.
  schemes.Link.countDocuments({}, (errorTotal, totalCrawledWebsites) => {
    schemes.Link.countDocuments({ is_harmful: true }, (errorHarmful, totalHarmfulWebsites) => {
      if (errorTotal || errorHarmful) {
        res.status(500).send('There was an error while fetching the stats.');
      } else {
        res.status(201).json({
          totalCrawledWebsites,
          totalHarmfulWebsites
        });
      }
    });
  });
}
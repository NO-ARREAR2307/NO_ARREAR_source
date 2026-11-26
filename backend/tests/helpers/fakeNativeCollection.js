'use strict';

// Minimal in-memory stand-in for a native MongoDB collection, with just the calls the migration uses:
// find({}).toArray(), insertOne, updateOne({ _id }, { $set, $unset }), indexes() and dropIndex(name).
// Every write is recorded in `writes`, so tests can prove that a dry run wrote nothing.

const mongoose = require('mongoose');

class FakeNativeCollection {
  constructor(docs = [], indexNames = []) {
    this.docs = docs.map((doc) => ({ ...doc }));
    this.indexNames = [...indexNames];
    this.writes = [];
  }

  find(filter = {}) {
    if (Object.keys(filter).length > 0) throw new Error('FakeNativeCollection only supports find({})');
    return { toArray: async () => this.docs.map((doc) => ({ ...doc })) };
  }

  async insertOne(doc) {
    const insertedId = new mongoose.Types.ObjectId();
    this.docs.push({ ...doc, _id: insertedId });
    this.writes.push({ op: 'insertOne', doc });
    return { insertedId };
  }

  async updateOne(filter, update) {
    const doc = this.docs.find((candidate) => String(candidate._id) === String(filter._id));
    if (!doc) return { matchedCount: 0 };
    Object.assign(doc, update.$set || {});
    Object.keys(update.$unset || {}).forEach((field) => delete doc[field]);
    this.writes.push({ op: 'updateOne', filter, update });
    return { matchedCount: 1 };
  }

  async indexes() {
    return [{ name: '_id_' }, ...this.indexNames.map((name) => ({ name }))];
  }

  async dropIndex(name) {
    this.indexNames = this.indexNames.filter((existing) => existing !== name);
    this.writes.push({ op: 'dropIndex', name });
  }
}

module.exports = FakeNativeCollection;

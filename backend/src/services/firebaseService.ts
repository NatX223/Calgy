import {
    Firestore,
    CollectionReference,
    Query,
    Timestamp,
    getFirestore
  } from 'firebase-admin/firestore';
  
  export class FirebaseService {
    private _firestore: Firestore | null = null;
  
    private get firestore(): Firestore {
      if (!this._firestore) {
        this._firestore = getFirestore();
      }
      return this._firestore;
    }
  
    /**
     * Get a collection reference
     */
    getCollection<T = any>(collectionName: string): CollectionReference<T> {
      return this.firestore.collection(collectionName) as CollectionReference<T>;
    }
  
    /**
     * Create a new document
     */
    async createDocument<T>(
      collectionName: string,
      data: T,
      documentId?: string
    ): Promise<string> {
      try {
        const collection = this.getCollection(collectionName);
  
        if (documentId) {
          await collection.doc(documentId).set({
            ...data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });
          return documentId;
        } else {
          const docRef = await collection.add({
            ...data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });
          return docRef.id;
        }
      } catch (error) {
        throw new Error(`Failed to create document in ${collectionName}: ${error}`);
      }
    }
  
    /**
     * Get a document by ID
     */
    async getDocument<T>(collectionName: string, documentId: string): Promise<T | null> {
      try {
        const docRef = this.getCollection(collectionName).doc(documentId);
        const doc = await docRef.get();
  
        if (!doc.exists) {
          return null;
        }
  
        return { id: doc.id, ...doc.data() } as T;
      } catch (error) {
        throw new Error(`Failed to get document ${documentId} from ${collectionName}: ${error}`);
      }
    }

    /**
     * Get a document by field value
     */
    async getDocumentByField<T>(
      collectionName: string, 
      fieldName: string, 
      fieldValue: any
    ): Promise<T | null> {
      try {
        const collection = this.getCollection(collectionName);
        const query = collection.where(fieldName, '==', fieldValue).limit(1);
        const snapshot = await query.get();

        if (snapshot.empty) {
          return null;
        }

        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() } as T;
      } catch (error) {
        throw new Error(`Failed to get document by ${fieldName} from ${collectionName}: ${error}`);
      }
    }

    /**
     * Add a document (alias for createDocument without ID)
     */
    async addDocument<T>(collectionName: string, data: T): Promise<string> {
      return this.createDocument(collectionName, data);
    }

    /**
     * Get all documents from a collection
     */
    async getAllDocuments<T>(collectionName: string): Promise<T[]> {
      try {
        const collection = this.firestore.collection(collectionName);
        const snapshot = await collection.get();
        
        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as T[];
      } catch (error) {
        throw new Error(`Failed to get collection ${collectionName}: ${error}`);
      }
    }
  
    /**
     * Update a document
     */
    async updateDocument<T>(
      collectionName: string,
      documentId: string,
      updates: Partial<T>
    ): Promise<void> {
      try {
        const docRef = this.getCollection(collectionName).doc(documentId);
        await docRef.update({
          ...updates,
          updatedAt: Timestamp.now()
        });
      } catch (error) {
        throw new Error(`Failed to update document ${documentId} in ${collectionName}: ${error}`);
      }
    }
  
    /**
     * Delete a document
     */
    async deleteDocument(collectionName: string, documentId: string): Promise<void> {
      try {
        const docRef = this.getCollection(collectionName).doc(documentId);
        await docRef.delete();
      } catch (error) {
        throw new Error(`Failed to delete document ${documentId} from ${collectionName}: ${error}`);
      }
    }
  
    /**
     * Query documents with filters
     */
    async queryDocuments<T>(
      collectionName: string,
      queryBuilder?: (collection: CollectionReference) => Query
    ): Promise<T[]> {
      try {
        const collection = this.getCollection(collectionName);
        const query = queryBuilder ? queryBuilder(collection) : collection;
        const snapshot = await query.get();
  
        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as T[];
      } catch (error) {
        throw new Error(`Failed to query documents from ${collectionName}: ${error}`);
      }
    }
  
    /**
     * Get documents with pagination
     */
    async getDocumentsPaginated<T>(
      collectionName: string,
      limit: number = 20,
      startAfter?: any,
      queryBuilder?: (collection: CollectionReference) => Query
    ): Promise<{ documents: T[], hasMore: boolean, lastDoc: any }> {
      try {
        const collection = this.getCollection(collectionName);
        let query = queryBuilder ? queryBuilder(collection) : collection;
  
        query = query.limit(limit + 1); // Get one extra to check if there are more
  
        if (startAfter) {
          query = query.startAfter(startAfter);
        }
  
        const snapshot = await query.get();
        const documents = snapshot.docs.slice(0, limit).map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as T[];
  
        const hasMore = snapshot.docs.length > limit;
        const lastDoc = documents.length > 0 ? snapshot.docs[documents.length - 1] : null;
  
        return { documents, hasMore, lastDoc };
      } catch (error) {
        throw new Error(`Failed to get paginated documents from ${collectionName}: ${error}`);
      }
    }
  
    /**
     * Batch operations
     */
    async batchWrite(operations: Array<{
      type: 'create' | 'update' | 'delete';
      collection: string;
      documentId?: string;
      data?: any;
    }>): Promise<void> {
      try {
        const batch = this.firestore.batch();
  
        for (const operation of operations) {
          const collection = this.getCollection(operation.collection);
  
          switch (operation.type) {
            case 'create':
              const docRef = operation.documentId
                ? collection.doc(operation.documentId)
                : collection.doc();
              batch.set(docRef, {
                ...operation.data,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
              });
              break;
  
            case 'update':
              if (!operation.documentId) {
                throw new Error('Document ID required for update operation');
              }
              batch.update(collection.doc(operation.documentId), {
                ...operation.data,
                updatedAt: Timestamp.now()
              });
              break;
  
            case 'delete':
              if (!operation.documentId) {
                throw new Error('Document ID required for delete operation');
              }
              batch.delete(collection.doc(operation.documentId));
              break;
          }
        }
  
        await batch.commit();
      } catch (error) {
        throw new Error(`Failed to execute batch operations: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  
    /**
     * Transaction operations
     */
    async runTransaction<T>(
      updateFunction: (transaction: any) => Promise<T>
    ): Promise<T> {
      try {
        return await this.firestore.runTransaction(updateFunction);
      } catch (error) {
        throw new Error(`Transaction failed: ${error}`);
      }
    }
  
    /**
     * Add document to subcollection
     */
    async addToSubcollection<T>(
      parentCollection: string,
      parentDocId: string,
      subcollection: string,
      data: T
    ): Promise<string> {
      try {
        const subcollectionRef = this.getCollection(parentCollection)
          .doc(parentDocId)
          .collection(subcollection);
  
        const docRef = await subcollectionRef.add({
          ...data,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
  
        return docRef.id;
      } catch (error) {
        throw new Error(`Failed to add to subcollection ${subcollection}: ${error}`);
      }
    }
  
    /**
     * Get subcollection documents
     */
    async getSubcollectionDocuments<T>(
      parentCollection: string,
      parentDocId: string,
      subcollection: string,
      queryBuilder?: (collection: CollectionReference) => Query
    ): Promise<T[]> {
      try {
        const subcollectionRef = this.getCollection(parentCollection)
          .doc(parentDocId)
          .collection(subcollection);
  
        const query = queryBuilder ? queryBuilder(subcollectionRef) : subcollectionRef;
        const snapshot = await query.get();
  
        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as T[];
      } catch (error) {
        throw new Error(`Failed to get subcollection ${subcollection}: ${error}`);
      }
    }
  }
  
  export const firebaseService = new FirebaseService();
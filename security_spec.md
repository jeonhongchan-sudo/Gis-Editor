# Security Specification

## Data Invariants
1. A project must belong to a user.
2. Entities (points, lines, etc.) must belong to a project.
3. Only the owner of a project can read or write its data.

## The "Dirty Dozen" Payloads (Examples to Reject)
1. Project with missing `ownerId`.
2. Entity belonging to a project ID that the user doesn't own.
3. Entity with a 1MB string in `layerName`.
4. Text entity with negative `height`.
5. Point with `x` or `y` as a string.
6. ... (and so on)

## Rules Draft
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    function isSignedIn() { return request.auth != null; }
    function isOwner(projectId) { return isSignedIn() && get(/databases/$(database)/documents/projects/$(projectId)).data.ownerId == request.auth.uid; }
    
    match /projects/{projectId} {
      allow read, write: if isSignedIn() && (resource == null || resource.data.ownerId == request.auth.uid);
      
      match /layers/{layerId} { allow read, write: if isOwner(projectId); }
      match /points/{pointId} { allow read, write: if isOwner(projectId); }
      match /lines/{lineId} { allow read, write: if isOwner(projectId); }
      match /polylines/{polylineId} { allow read, write: if isOwner(projectId); }
      match /polygons/{polygonId} { allow read, write: if isOwner(projectId); }
      match /texts/{textId} { allow read, write: if isOwner(projectId); }
    }
  }
}
```

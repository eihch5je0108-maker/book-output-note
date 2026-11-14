/* Firebase の設定
   - null のままなら、今まで通り「この端末だけに保存」で動きます。
   - Firebase コンソールの「SDK の設定と構成」に出てくる firebaseConfig の中身を入れると、
     Googleログイン＋クラウド保存（スマホとPCで同期）になります。
   - ここの値は「どのFirebaseプロジェクトか」を示す名札のようなもので、パスワードではありません。
     記録を守るのは Firestore のルール（firestore.rules）です。 */
window.FIREBASE_CONFIG = null;
